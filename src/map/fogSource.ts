import type { Feature, FeatureCollection, Point } from 'geojson';
import { COARSE_FOG_RES } from '../config';
import { type Bounds, type LngLat, cellCentre, parentCells, pointsBounds } from '../core/fog';
import { areaKm2 } from '../core/stats';

/** Cells stored after a rowid, as returned by cellsAddedSince. */
export type NewCells = { ids: string[]; lastRowid: number };

/** Revealed places as points; the map draws them as a heatmap that clears the fog. */
export type FogPoints = FeatureCollection<Point>;

export const NO_FOG_POINTS: FogPoints = { type: 'FeatureCollection', features: [] };

export type FogUpdate = {
  /** One point per stored cell, at its centre. */
  fog: FogPoints;
  /** One point per res-COARSE_FOG_RES parent of the stored cells, for zoomed-out views. */
  coarseFog: FogPoints;
  cellCount: number;
  areaKm2: number;
  bounds: Bounds | null;
  /** Cells added by this refresh. */
  added: number;
  /** JS time spent, not counting the pauses between slices. */
  ms: number;
};

// Keeps each blocking stretch of the first, large load short.
const SLICE_CELLS = 2_000;

function point(coordinates: LngLat): Feature<Point> {
  return { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates } };
}

function unionBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (a === null) return b;
  if (b === null) return a;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/**
 * Keeps the fog's points for the app's lifetime and adds only the cells stored
 * since the last refresh, in slices with a pause between them. A refresh costs
 * a few h3 lookups per new cell; the GPU heatmap does the drawing.
 */
export class FogSource {
  private points: Feature<Point>[] = [];
  private coarsePoints: Feature<Point>[] = [];
  private readonly coarseSeen = new Set<string>();
  private lastRowid = 0;
  private needsReset = false;
  private area = 0;
  private bounds: Bounds | null = null;

  constructor(
    private readonly readSince: (afterRowid: number) => Promise<NewCells>,
    private readonly pause: () => Promise<void>,
    private readonly now: () => number,
    private readonly sliceCells = SLICE_CELLS,
  ) {}

  /** Stored cells were deleted: the next refresh starts again from rowid 0. */
  markReset(): void {
    this.needsReset = true;
  }

  /** The fog after adding newly stored cells, or null when nothing changed. */
  async refresh(): Promise<FogUpdate | null> {
    const reset = this.needsReset;
    this.needsReset = false;
    try {
      const { ids, lastRowid } = await this.readSince(reset ? 0 : this.lastRowid);
      if (!reset && ids.length === 0) return null;
      let ms = 0;
      let start = this.now();
      if (reset) {
        this.points = [];
        this.coarsePoints = [];
        this.coarseSeen.clear();
        this.area = 0;
        this.bounds = null;
      }
      for (let i = 0; i < ids.length; i += this.sliceCells) {
        if (i > 0) {
          ms += this.now() - start;
          await this.pause();
          start = this.now();
        }
        const slice = ids.slice(i, i + this.sliceCells);
        const centres = slice.map(cellCentre);
        for (const c of centres) this.points.push(point(c));
        for (const parent of parentCells(slice, COARSE_FOG_RES)) {
          if (this.coarseSeen.has(parent)) continue;
          this.coarseSeen.add(parent);
          this.coarsePoints.push(point(cellCentre(parent)));
        }
        this.area += areaKm2(slice);
        this.bounds = unionBounds(this.bounds, pointsBounds(centres));
      }
      // Fresh arrays, so earlier results stay unchanged and the map sees new data.
      const fog: FogPoints = { type: 'FeatureCollection', features: [...this.points] };
      const coarseFog: FogPoints = { type: 'FeatureCollection', features: [...this.coarsePoints] };
      ms += this.now() - start;
      this.lastRowid = lastRowid;
      return {
        fog,
        coarseFog,
        cellCount: this.points.length,
        areaKm2: this.area,
        bounds: this.bounds,
        added: ids.length,
        ms,
      };
    } catch (e) {
      // The points may hold part of a slice: rebuild everything next time.
      this.needsReset = true;
      throw e;
    }
  }
}
