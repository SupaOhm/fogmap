import type { Feature, MultiPolygon } from 'geojson';
import { COARSE_FOG_RES } from '../config';
import { type Bounds, FogBuilder, cellsBounds, parentCells } from '../core/fog';
import { areaKm2 } from '../core/stats';

/** Cells stored after a rowid, as returned by cellsAddedSince. */
export type NewCells = { ids: string[]; lastRowid: number };

export type FogUpdate = {
  fog: Feature<MultiPolygon>;
  /** The same fog from the cells' res-COARSE_FOG_RES parents, for zoomed-out views. */
  coarseFog: Feature<MultiPolygon>;
  cellCount: number;
  areaKm2: number;
  bounds: Bounds | null;
  /** Cells added by this refresh. */
  added: number;
  /** JS time spent, not counting the pauses between slices. */
  ms: number;
};

// ~0.14 ms per cell on an iPhone 14 (Release), so one slice blocks for ~0.3 s.
const SLICE_CELLS = 2_000;

function unionBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (a === null) return b;
  if (b === null) return a;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/**
 * Keeps one FogBuilder for the app's lifetime and feeds it only the cells stored
 * since the last refresh, in slices with a pause between them. An update costs
 * the new cells plus one toFeature, never a full rebuild (a full rebuild of
 * 50,000 cells takes ~7 s on an iPhone 14).
 */
export class FogSource {
  private readonly builder = new FogBuilder();
  private readonly coarse = new FogBuilder();
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
        this.builder.reset();
        this.coarse.reset();
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
        this.builder.add(slice);
        this.coarse.add(parentCells(slice, COARSE_FOG_RES));
        this.area += areaKm2(slice);
        this.bounds = unionBounds(this.bounds, cellsBounds(slice));
      }
      const fog = this.builder.toFeature();
      const coarseFog = this.coarse.toFeature();
      ms += this.now() - start;
      this.lastRowid = lastRowid;
      return { fog, coarseFog, cellCount: this.builder.size, areaKm2: this.area, bounds: this.bounds, added: ids.length, ms };
    } catch (e) {
      // The builder may hold part of a slice: rebuild everything next time.
      this.needsReset = true;
      throw e;
    }
  }
}
