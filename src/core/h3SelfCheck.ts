import {
  UNITS,
  cellArea,
  cellsToMultiPolygon,
  gridDisk,
  gridPathCells,
  isValidCell,
  latLngToCell,
} from 'h3-js';
import { H3_RES } from './constants';

export type CheckResult = { name: string; ok: boolean; detail: string };

const BANGKOK = { lat: 13.7563, lng: 100.5018 };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** Exercises every h3-js function the app uses; safe to run on device. */
export function runH3SelfCheck(): CheckResult[] {
  const origin = latLngToCell(BANGKOK.lat, BANGKOK.lng, H3_RES);
  const checks: Array<[string, () => string]> = [
    ['latLngToCell', () => {
      assert(isValidCell(origin), `invalid cell ${origin}`);
      return origin;
    }],
    ['gridDisk', () => {
      const n = gridDisk(origin, 1).length;
      assert(n === 7, `expected 7 cells, got ${n}`);
      return `${n} cells`;
    }],
    ['gridPathCells', () => {
      const end = latLngToCell(BANGKOK.lat, BANGKOK.lng + 0.01, H3_RES);
      const path = gridPathCells(origin, end);
      assert(path.length > 2, `path too short: ${path.length}`);
      return `${path.length} cells over ~1 km`;
    }],
    ['cellsToMultiPolygon', () => {
      const cells = gridDisk(origin, 50);
      const t0 = Date.now();
      const polygons = cellsToMultiPolygon(cells, true);
      const ms = Date.now() - t0;
      assert(polygons.length === 1, `expected 1 polygon, got ${polygons.length}`);
      return `${cells.length} cells -> ${polygons.length} polygon in ${ms} ms`;
    }],
    ['cellArea', () => {
      const km2 = cellArea(origin, UNITS.km2);
      assert(km2 > 0.01 && km2 < 0.02, `unexpected area ${km2}`);
      return `${km2.toFixed(5)} km²`;
    }],
  ];
  return checks.map(([name, run]) => {
    try {
      return { name, ok: true, detail: run() };
    } catch (e) {
      return { name, ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  });
}
