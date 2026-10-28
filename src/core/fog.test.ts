import { gridDisk, latLngToCell } from 'h3-js';
import { H3_RES } from './constants';
import { WORLD_RING, buildFog } from './fog';

const centre = latLngToCell(13.7563, 100.5018, H3_RES);

test('no cells means the whole world is fog', () => {
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
