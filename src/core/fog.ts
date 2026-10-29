import { cellToLatLng, cellToParent } from 'h3-js';

export type Bounds = [west: number, south: number, east: number, north: number];
/** A position in GeoJSON order. */
export type LngLat = [lng: number, lat: number];

/** A cell's centre. The fog is a heatmap of revealed cell centres; hexagons are never drawn. */
export function cellCentre(cell: string): LngLat {
  const [lat, lng] = cellToLatLng(cell);
  return [lng, lat];
}

/** Bounding box of the points, or null without points. Ignores the antimeridian. */
export function pointsBounds(points: Iterable<LngLat>): Bounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of points) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return west === Infinity ? null : [west, south, east, north];
}

/** The unique parents of cells at a coarser resolution, in first-seen order (coarse fog when zoomed out). */
export function parentCells(cells: Iterable<string>, res: number): string[] {
  const parents = new Set<string>();
  for (const c of cells) parents.add(cellToParent(c, res));
  return [...parents];
}
