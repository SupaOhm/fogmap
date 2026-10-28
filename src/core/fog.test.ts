import { cellToLatLng, gridDisk, latLngToCell } from 'h3-js';
import { H3_RES } from './constants';
import { WORLD_RING, buildFog, cellsBounds } from './fog';

const centre = latLngToCell(13.7563, 100.5018, H3_RES);

test('no cells means the whole world is fog', () => {
  expect(buildFog([]).geometry.coordinates).toEqual([[WORLD_RING]]);
});

test("the world ring reaches Web Mercator's limit", () => {
  const lats = WORLD_RING.map(([, lat]) => lat);
  expect(Math.max(...lats)).toBeCloseTo(85.051129, 6);
  expect(Math.min(...lats)).toBeCloseTo(-85.051129, 6);
});

test('changing one result does not change the next', () => {
  const first = buildFog([]);
  first.geometry.coordinates[0]![0]![0]![0] = 0;
  expect(buildFog([]).geometry.coordinates).toEqual([[WORLD_RING]]);
});

test('one cell becomes one hexagonal hole', () => {
  const coords = buildFog([centre]).geometry.coordinates;
  expect(coords).toHaveLength(1);
  expect(coords[0]).toHaveLength(2);
  expect(coords[0]![1]).toHaveLength(7); // 6 vertices + closing point
});

test('an unrevealed cell surrounded by revealed cells stays fogged', () => {
  const ring = gridDisk(centre, 1).filter((c) => c !== centre);
  const coords = buildFog(ring).geometry.coordinates;
  expect(coords).toHaveLength(2);
  expect(coords[0]).toHaveLength(2); // world + outer edge of the ring
  expect(coords[1]).toHaveLength(1); // the island
  expect(coords[1]![0]).toHaveLength(7);
});

test('holes use GeoJSON [lng, lat] order', () => {
  const [lng, lat] = buildFog([centre]).geometry.coordinates[0]![1]![0]!;
  expect(lng).toBeCloseTo(100.5, 1);
  expect(lat).toBeCloseTo(13.76, 1);
});

describe('cellsBounds', () => {
  test('is null without cells', () => {
    expect(cellsBounds([])).toBeNull();
  });

  test('is the centre point for one cell, as [west, south, east, north]', () => {
    const [lat, lng] = cellToLatLng(centre);
    expect(cellsBounds([centre])).toEqual([lng, lat, lng, lat]);
  });

  test('covers every cell centre', () => {
    const far = latLngToCell(13.9, 100.7, H3_RES);
    const [west, south, east, north] = cellsBounds([centre, far])!;
    for (const c of [centre, far]) {
      const [lat, lng] = cellToLatLng(c);
      expect(lng).toBeGreaterThanOrEqual(west);
      expect(lng).toBeLessThanOrEqual(east);
      expect(lat).toBeGreaterThanOrEqual(south);
      expect(lat).toBeLessThanOrEqual(north);
    }
    expect(east - west).toBeGreaterThan(0.1);
  });
});
