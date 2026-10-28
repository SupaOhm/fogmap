import { cellToLatLng, cellToVertexes, vertexToLatLng } from 'h3-js';
import type { Feature, MultiPolygon, Position } from 'geojson';

// Web Mercator's limit; MapLibre cannot show anything beyond it.
const MAX_LAT = 85.051129;

export const WORLD_RING: readonly (readonly [number, number])[] = [
  [-180, -MAX_LAT],
  [180, -MAX_LAT],
  [180, MAX_LAT],
  [-180, MAX_LAT],
  [-180, -MAX_LAT],
];

export type Bounds = [west: number, south: number, east: number, north: number];

type LngLat = [number, number];
type Ring = { coords: LngLat[]; area: number; west: number; south: number; east: number; north: number };

/**
 * Fog outline built incrementally. Each revealed cell adds its edges (H3 gives
 * vertices counter-clockwise, and neighbours share vertex ids); an edge shared
 * with a revealed neighbour cancels out, so the open edges are exactly the
 * boundary of the revealed area. Needs one cheap h3 call per cell, unlike
 * cellsToMultiPolygon, which is ~10 s for 50k cells on Hermes. Ignores the antimeridian.
 */
export class FogBuilder {
  private readonly cells = new Set<string>();
  /** Open boundary edges, from vertex → to vertex. At most one per vertex: three cells meet at each. */
  private readonly edges = new Map<string, string>();
  private readonly vertexCoords = new Map<string, LngLat>();

  get size(): number {
    return this.cells.size;
  }

  add(cells: Iterable<string>): void {
    for (const cell of cells) {
      if (this.cells.has(cell)) continue;
      this.cells.add(cell);
      const vertices = cellToVertexes(cell);
      // Cancel shared edges first: a vertex briefly has two open edges otherwise,
      // depending on which edge of the cell comes first.
      const open: [string, string][] = [];
      for (let i = 0; i < vertices.length; i++) {
        const from = vertices[i]!;
        const to = vertices[(i + 1) % vertices.length]!;
        if (this.edges.get(to) === from) this.edges.delete(to);
        else open.push([from, to]);
      }
      for (const [from, to] of open) {
        if (this.edges.has(from)) throw new Error(`fog outline touches itself at vertex ${from}`);
        this.edges.set(from, to);
      }
    }
  }

  reset(): void {
    this.cells.clear();
    this.edges.clear();
    this.vertexCoords.clear();
  }

  /**
   * Fog as one world polygon with every revealed area as a hole; each unrevealed
   * island is its own polygon, with the revealed areas inside it as holes.
   * Exterior rings are counter-clockwise and holes clockwise (RFC 7946).
   */
  toFeature(): Feature<MultiPolygon> {
    const outlines: Ring[] = [];
    const islands: Ring[] = [];
    for (const ring of this.rings()) (ring.area > 0 ? outlines : islands).push(ring);

    const worldHoles: Position[][] = [];
    const islandHoles = islands.map((): Position[][] => []);
    for (const outline of outlines) {
      const i = innermostContaining(islands, outline.coords[0]!);
      (i === -1 ? worldHoles : islandHoles[i]!).push(reversedClosed(outline.coords));
    }

    // A fresh copy of the world ring, so callers cannot change the shared one.
    const world: Position[] = WORLD_RING.map(([lng, lat]) => [lng, lat]);
    return {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [world, ...worldHoles],
          ...islands.map((island, i) => [reversedClosed(island.coords), ...islandHoles[i]!]),
        ],
      },
    };
  }

  /** Follows the open edges into closed rings. Revealed outlines come out counter-clockwise, islands clockwise. */
  private rings(): Ring[] {
    const next = new Map(this.edges);
    const rings: Ring[] = [];
    for (const start of this.edges.keys()) {
      if (!next.has(start)) continue;
      const coords: LngLat[] = [];
      let v = start;
      do {
        coords.push(this.coord(v));
        const to = next.get(v);
        if (to === undefined) throw new Error(`fog outline is not closed at vertex ${v}`);
        next.delete(v);
        v = to;
      } while (v !== start);
      rings.push(measure(coords));
    }
    return rings;
  }

  private coord(vertex: string): LngLat {
    let c = this.vertexCoords.get(vertex);
    if (!c) {
      const [lat, lng] = vertexToLatLng(vertex);
      c = [lng, lat];
      this.vertexCoords.set(vertex, c);
    }
    return c;
  }
}

/** Fog for a set of revealed cells (see FogBuilder). */
export function buildFog(cells: Iterable<string>): Feature<MultiPolygon> {
  const builder = new FogBuilder();
  builder.add(cells);
  return builder.toFeature();
}

function measure(coords: LngLat[]): Ring {
  let twiceArea = 0;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (let i = 0; i < coords.length; i++) {
    const [x1, y1] = coords[i]!;
    const [x2, y2] = coords[(i + 1) % coords.length]!;
    twiceArea += x1 * y2 - x2 * y1;
    west = Math.min(west, x1);
    east = Math.max(east, x1);
    south = Math.min(south, y1);
    north = Math.max(north, y1);
  }
  return { coords, area: twiceArea / 2, west, south, east, north };
}

/** Index of the smallest island containing the point, or -1. Outlines never touch islands, so any vertex decides. */
function innermostContaining(islands: Ring[], [x, y]: LngLat): number {
  let best = -1;
  for (let i = 0; i < islands.length; i++) {
    const r = islands[i]!;
    if (x < r.west || x > r.east || y < r.south || y > r.north || !pointInRing(r.coords, x, y)) continue;
    if (best === -1 || Math.abs(r.area) < Math.abs(islands[best]!.area)) best = i;
  }
  return best;
}

function pointInRing(ring: LngLat[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The ring reversed (flips its winding) and closed with its first point. */
function reversedClosed(coords: LngLat[]): Position[] {
  const out: Position[] = coords.map(([lng, lat]) => [lng, lat]).reverse();
  out.push([...out[0]!]);
  return out;
}

/** Bounding box of the cell centres, or null without cells. Ignores the antimeridian. */
export function cellsBounds(cells: readonly string[]): Bounds | null {
  if (cells.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const c of cells) {
    const [lat, lng] = cellToLatLng(c);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return [west, south, east, north];
}
