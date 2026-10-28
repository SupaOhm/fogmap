import { areNeighborCells, gridDisk, latLngToCell } from 'h3-js';
import { H3_RES } from './constants';
import { expandCells, pathCells, shouldFillGap } from './reveal';

const a = latLngToCell(13.7563, 100.5018, H3_RES);
const b = latLngToCell(13.7563, 100.5118, H3_RES); // ~1 km east

describe('shouldFillGap', () => {
  test('fills just under both limits', () => {
    expect(shouldFillGap(1999, 599_999)).toBe(true);
  });
  test('does not fill at exactly 2 km', () => {
    expect(shouldFillGap(2000, 0)).toBe(false);
  });
  test('does not fill at exactly 10 minutes', () => {
    expect(shouldFillGap(0, 600_000)).toBe(false);
  });
});

describe('pathCells', () => {
  test('returns only the target without a previous cell', () => {
    expect(pathCells(null, b, true)).toEqual([b]);
  });
  test('returns only the target when filling is off', () => {
    expect(pathCells(a, b, false)).toEqual([b]);
  });
  test('returns a single cell when both ends are the same cell', () => {
    expect(pathCells(a, a, true)).toEqual([a]);
  });
  test('returns a contiguous path from start to end', () => {
    const path = pathCells(a, b, true);
    expect(path[0]).toBe(a);
    expect(path[path.length - 1]).toBe(b);
    for (let i = 1; i < path.length; i++) {
      expect(areNeighborCells(path[i - 1]!, path[i]!)).toBe(true);
    }
  });
  test('takes the short way across the antimeridian', () => {
    const west = latLngToCell(0, 179.9995, H3_RES);
    const east = latLngToCell(0, -179.9995, H3_RES);
    expect(pathCells(west, east, true).length).toBeLessThan(20);
  });
});

describe('expandCells', () => {
  test('one cell expands to itself plus 6 neighbours', () => {
    expect(expandCells([a]).size).toBe(7);
  });
  test('two adjacent cells expand to 10 unique cells', () => {
    const neighbour = gridDisk(a, 1).find((c) => c !== a)!;
    expect(expandCells([a, neighbour]).size).toBe(10);
  });
  test('radius 0 keeps only the input cells', () => {
    expect([...expandCells([a, b], 0)].sort()).toEqual([a, b].sort());
  });
});
