import { cellsToMultiPolygon } from 'h3-js';
import type { Feature, MultiPolygon, Position } from 'geojson';

// Web Mercator ends at ~85.05°, so this covers everything MapLibre can show.
export const WORLD_RING: Position[] = [
  [-180, -85],
  [180, -85],
  [180, 85],
  [-180, 85],
  [-180, -85],
];

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
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'MultiPolygon', coordinates: [[WORLD_RING, ...outerRings], ...islands] },
  };
}
