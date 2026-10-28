import { cellToLatLng, latLngToCell } from 'h3-js';
import { H3_RES } from './constants';
import { cellRadiusM, distanceFromPrevM, distanceM } from './geo';

const LAT = 13.7563;
const LNG = 100.5018;

test('distanceM: 0.01° of longitude in Bangkok is about 1081 m', () => {
  const d = distanceM(LAT, LNG, LAT, LNG + 0.01);
  expect(d).toBeGreaterThan(1070);
  expect(d).toBeLessThan(1090);
});

test('cellRadiusM of a res-10 cell is roughly one edge length', () => {
  const r = cellRadiusM(latLngToCell(LAT, LNG, H3_RES));
  expect(r).toBeGreaterThan(50);
  expect(r).toBeLessThan(90);
});

test('distanceFromPrevM uses exact coordinates when present', () => {
  const prev = { cell: latLngToCell(LAT, LNG, H3_RES), ts: 0, lat: LAT, lng: LNG };
  expect(distanceFromPrevM(prev, LAT, LNG + 0.01)).toBeCloseTo(
    distanceM(LAT, LNG, LAT, LNG + 0.01),
  );
});

test('distanceFromPrevM with a cell-only point returns a lower bound', () => {
  const cell = latLngToCell(LAT, LNG, H3_RES);
  const [cLat, cLng] = cellToLatLng(cell);
  const prev = { cell, ts: 0 };
  expect(distanceFromPrevM(prev, cLat, cLng)).toBe(0);
  const far = distanceFromPrevM(prev, LAT, LNG + 0.01);
  const centre = distanceM(cLat, cLng, LAT, LNG + 0.01);
  expect(far).toBeCloseTo(centre - cellRadiusM(cell));
});
