import { cellToLatLng, cellToParent, getResolution, gridDisk, latLngToCell } from 'h3-js';
import { H3_RES } from './constants';
import { cellCentre, parentCells, pointsBounds } from './fog';

const centre = latLngToCell(13.7563, 100.5018, H3_RES);

describe('cellCentre', () => {
  test('is the cell centre in GeoJSON [lng, lat] order', () => {
    const [lat, lng] = cellToLatLng(centre);
    expect(cellCentre(centre)).toEqual([lng, lat]);
  });
});

describe('pointsBounds', () => {
  test('is null without points', () => {
    expect(pointsBounds([])).toBeNull();
  });
  test('is the point itself for one point, as [west, south, east, north]', () => {
    expect(pointsBounds([[100.5, 13.7]])).toEqual([100.5, 13.7, 100.5, 13.7]);
  });
  test('covers every point', () => {
    expect(
      pointsBounds([
        [100.5, 13.9],
        [100.7, 13.7],
        [100.6, 13.8],
      ]),
    ).toEqual([100.5, 13.7, 100.7, 13.9]);
  });
});

describe('parentCells', () => {
  test('maps cells to their unique parents at the given resolution', () => {
    const disk = gridDisk(centre, 2);
    const parents = parentCells(disk, 8);
    expect(new Set(parents)).toEqual(new Set(disk.map((c) => cellToParent(c, 8))));
    expect(parents.length).toBe(new Set(parents).size);
    expect(parents.every((p) => getResolution(p) === 8)).toBe(true);
  });
  test('is empty without cells', () => {
    expect(parentCells([], 8)).toEqual([]);
  });
});
