import { cellToLatLng, cellsToMultiPolygon, gridDisk, latLngToCell } from 'h3-js';
import type { Feature, MultiPolygon, Position } from 'geojson';
import { H3_RES } from './constants';
import { FogBuilder, WORLD_RING, buildFog, cellsBounds } from './fog';
import { stressCells } from './stress';

const centre = latLngToCell(13.7563, 100.5018, H3_RES);

const BANGKOK = { lat: 13.7563, lng: 100.5018 };

/** Order-independent key of a closed ring: its vertices, rounded and sorted. */
const ringKey = (ring: Position[]) =>
  ring
    .slice(0, -1)
    .map(([lng, lat]) => `${lng!.toFixed(7)},${lat!.toFixed(7)}`)
    .sort()
    .join(';');

/** Order-independent shape of a fog feature, for comparing builds. */
const shape = (f: Feature<MultiPolygon>) =>
  f.geometry.coordinates.map((polygon) => polygon.map(ringKey).join('|')).sort();

const signedArea = (ring: Position[]) => {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i]![0]! * ring[i + 1]![1]! - ring[i + 1]![0]! * ring[i]![1]!;
  }
  return a / 2;
};

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
  expect(buildFog([]).geometry.coordinates[0]![0]![0]).toEqual([-180, -85.051129]);
  expect(WORLD_RING[0]).toEqual([-180, -85.051129]);
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

test('a revealed cell inside an unrevealed island is a hole in that island', () => {
  const inner = gridDisk(centre, 1);
  const revealed = [...gridDisk(centre, 2).filter((c) => !inner.includes(c)), centre];
  const coords = buildFog(revealed).geometry.coordinates;
  expect(coords).toHaveLength(2);
  expect(coords[0]).toHaveLength(2); // world + outer edge of the revealed ring
  expect(coords[1]).toHaveLength(2); // the unrevealed island, with the centre cell as its hole
  expect(coords[1]![1]).toHaveLength(7);
});

test('rings follow RFC 7946: exteriors counter-clockwise, holes clockwise', () => {
  const inner = gridDisk(centre, 1);
  const revealed = [...gridDisk(centre, 2).filter((c) => !inner.includes(c)), centre];
  for (const polygon of buildFog(revealed).geometry.coordinates) {
    expect(signedArea(polygon[0]!)).toBeGreaterThan(0);
    for (const hole of polygon.slice(1)) expect(signedArea(hole)).toBeLessThan(0);
  }
});

test('outlines match h3 cellsToMultiPolygon on a long route', () => {
  const cells = stressCells(10_000, 1, BANGKOK);
  const [[, ...holes], ...islands] = buildFog(cells).geometry.coordinates;
  const ours = [...holes!, ...islands.flat()];
  const reference = cellsToMultiPolygon(cells, true).flat();
  expect(ours.length).toBeGreaterThan(1); // the route has islands, so this is not trivial
  expect(ours).toHaveLength(reference.length);
  expect(new Set(ours.map(ringKey))).toEqual(new Set(reference.map(ringKey)));
});

describe('FogBuilder', () => {
  test('adding cells in batches gives the same fog as all at once', () => {
    const cells = stressCells(2000, 3, BANGKOK);
    const builder = new FogBuilder();
    builder.add(cells.slice(0, 700));
    builder.add(cells.slice(700));
    expect(builder.size).toBe(2000);
    expect(shape(builder.toFeature())).toEqual(shape(buildFog(cells)));
  });

  test('adding a cell twice changes nothing', () => {
    const builder = new FogBuilder();
    builder.add([centre]);
    builder.add([centre, centre]);
    expect(builder.size).toBe(1);
    expect(shape(builder.toFeature())).toEqual(shape(buildFog([centre])));
  });

  test('a later cell can fill an island', () => {
    const builder = new FogBuilder();
    builder.add(gridDisk(centre, 1).filter((c) => c !== centre));
    expect(builder.toFeature().geometry.coordinates).toHaveLength(2);
    builder.add([centre]);
    expect(builder.toFeature().geometry.coordinates).toHaveLength(1);
  });

  test('reset clears every cell', () => {
    const builder = new FogBuilder();
    builder.add(gridDisk(centre, 1));
    builder.reset();
    expect(builder.size).toBe(0);
    expect(builder.toFeature().geometry.coordinates).toEqual([[WORLD_RING]]);
  });
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
