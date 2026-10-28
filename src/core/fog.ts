import { cellToLatLng, cellsToMultiPolygon } from 'h3-js';
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

/**
 * Fog as one world polygon with every revealed area as a hole. Unrevealed islands
 * inside a revealed area become separate polygons, since holes cannot nest.
 */
export function buildFog(cells: string[]): Feature<MultiPolygon> {
  const outerRings: Position[][] = [];
  const islands: Position[][][] = [];
  for (const [outer, ...inner] of cellsToMultiPolygon(cells, true)) {
    if (outer) outerRings.push(outer);
    for (const ring of inner) islands.push([ring]);
  }
  // A fresh copy of the world ring, so callers cannot change the shared one.
  const world: Position[] = WORLD_RING.map(([lng, lat]) => [lng, lat]);
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'MultiPolygon', coordinates: [[world, ...outerRings], ...islands] },
  };
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
