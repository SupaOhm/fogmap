import { UNITS, cellToBoundary, cellToLatLng, greatCircleDistance } from 'h3-js';
import type { LastPoint } from './types';

export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  return greatCircleDistance([aLat, aLng], [bLat, bLng], UNITS.m);
}

/** Largest distance from the cell centre to any of its vertices. */
export function cellRadiusM(cell: string): number {
  const [lat, lng] = cellToLatLng(cell);
  let max = 0;
  for (const [vLat, vLng] of cellToBoundary(cell)) {
    max = Math.max(max, distanceM(lat, lng, vLat, vLng));
  }
  return max;
}

/**
 * Distance from the previous point. With only a cell (after a relaunch) this is a
 * lower bound, so imprecision can never make a real fix look too fast.
 */
export function distanceFromPrevM(prev: LastPoint, lat: number, lng: number): number {
  if (prev.lat !== undefined && prev.lng !== undefined) {
    return distanceM(prev.lat, prev.lng, lat, lng);
  }
  const [cLat, cLng] = cellToLatLng(prev.cell);
  return Math.max(0, distanceM(cLat, cLng, lat, lng) - cellRadiusM(prev.cell));
}
