import {
  UNITS,
  cellArea,
  cellToLatLng,
  cellToParent,
  gridDisk,
  getResolution,
  gridPathCells,
  isValidCell,
  latLngToCell,
} from 'h3-js';
import { H3_RES } from './constants';

export type CheckResult = { name: string; ok: boolean; detail: string };

const PARENT_RES = 8; // the coarse fog resolution
const BANGKOK = { lat: 13.7563, lng: 100.5018 };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** Exercises the h3-js functions the app uses (cell, grid, centre and parent lookups); safe to run on device. */
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
    ['cellToLatLng', () => {
      const [lat, lng] = cellToLatLng(origin);
      const metres = Math.hypot((lat - BANGKOK.lat) * 111_000, (lng - BANGKOK.lng) * 111_000 * Math.cos((BANGKOK.lat * Math.PI) / 180));
      assert(metres < 100, `centre ${metres.toFixed(0)} m from the input point`);
      return `centre ${metres.toFixed(0)} m from the input point`;
    }],
    ['cellToParent', () => {
      const parent = cellToParent(origin, PARENT_RES);
      assert(getResolution(parent) === PARENT_RES, `parent resolution ${getResolution(parent)}`);
      assert(cellToParent(origin, PARENT_RES) === parent, 'parent not stable');
      return `res ${PARENT_RES} parent ${parent}`;
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
