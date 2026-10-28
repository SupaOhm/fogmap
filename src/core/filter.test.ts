import { cellToLatLng, gridDisk, latLngToCell } from 'h3-js';
import { H3_RES } from './constants';
import { evaluateFix } from './filter';
import type { Fix, LastPoint } from './types';

const LAT = 13.7563;
const LNG = 100.5018;
const EAST_1KM = LNG + 0.01; // ~1081 m east

function fix(over: Partial<Fix> = {}): Fix {
  return { ts: 0, lat: LAT, lng: LNG, accuracy: 10, speed: null, ...over };
}

function exactPrev(ts: number): LastPoint {
  return { cell: latLngToCell(LAT, LNG, H3_RES), ts, lat: LAT, lng: LNG };
}

describe('accuracy', () => {
  test('rejects missing accuracy', () => {
    expect(evaluateFix(fix({ accuracy: null }), null)).toEqual({ accepted: false, reason: 'accuracy' });
  });
  test('rejects accuracy worse than 50 m', () => {
    expect(evaluateFix(fix({ accuracy: 51 }), null)).toEqual({ accepted: false, reason: 'accuracy' });
  });
  test('accepts accuracy of exactly 50 m', () => {
    expect(evaluateFix(fix({ accuracy: 50 }), null).accepted).toBe(true);
  });
});

describe('validity', () => {
  test('rejects negative accuracy', () => {
    expect(evaluateFix(fix({ accuracy: -1 }), null)).toEqual({ accepted: false, reason: 'accuracy' });
  });
  test('rejects NaN accuracy', () => {
    expect(evaluateFix(fix({ accuracy: NaN }), null)).toEqual({ accepted: false, reason: 'accuracy' });
  });
  test('rejects NaN latitude', () => {
    expect(evaluateFix(fix({ lat: NaN }), null)).toEqual({ accepted: false, reason: 'invalid' });
  });
  test('rejects NaN timestamp', () => {
    expect(evaluateFix(fix({ ts: NaN }), null)).toEqual({ accepted: false, reason: 'invalid' });
  });
  test('rejects latitude 95', () => {
    expect(evaluateFix(fix({ lat: 95 }), null)).toEqual({ accepted: false, reason: 'invalid' });
  });
  test('rejects longitude 181', () => {
    expect(evaluateFix(fix({ lng: 181 }), null)).toEqual({ accepted: false, reason: 'invalid' });
  });
  test('rejects a fix older than the previous point', () => {
    expect(evaluateFix(fix({ ts: 5_000 }), exactPrev(10_000))).toEqual({
      accepted: false,
      reason: 'stale',
    });
  });
});

describe('long gaps', () => {
  const LONDON = { lat: 51.47, lng: -0.4543, ts: 13 * 3_600_000 };
  test('no speed check after a flight; unknown speed is vehicle', () => {
    expect(evaluateFix(fix(LONDON), exactPrev(0))).toEqual({ accepted: true, bucket: 'vehicle' });
  });
  test('a negative reported speed after a long gap is treated as unknown', () => {
    expect(evaluateFix(fix({ ...LONDON, speed: -1 }), exactPrev(0))).toEqual({
      accepted: true,
      bucket: 'vehicle',
    });
  });
  test('a valid reported speed is still used after a long gap', () => {
    expect(evaluateFix(fix({ ...LONDON, speed: 1.2 }), exactPrev(0))).toEqual({
      accepted: true,
      bucket: 'walk',
    });
  });
});

describe('first fix (no previous point)', () => {
  test('without speed is bucketed as vehicle', () => {
    expect(evaluateFix(fix(), null)).toEqual({ accepted: true, bucket: 'vehicle' });
  });
  test('uses reported speed', () => {
    expect(evaluateFix(fix({ speed: 10 }), null)).toEqual({ accepted: true, bucket: 'vehicle' });
  });
});

describe('speed check', () => {
  test('accepts ~65 km/h (1081 m in 60 s)', () => {
    expect(evaluateFix(fix({ ts: 60_000, lng: EAST_1KM }), exactPrev(0))).toEqual({
      accepted: true,
      bucket: 'vehicle',
    });
  });
  test('rejects ~389 km/h (1081 m in 10 s)', () => {
    expect(evaluateFix(fix({ ts: 10_000, lng: EAST_1KM }), exactPrev(0))).toEqual({
      accepted: false,
      reason: 'speed',
    });
  });
  test('accepts a duplicate timestamp at the same position', () => {
    expect(evaluateFix(fix({ ts: 5_000 }), exactPrev(5_000)).accepted).toBe(true);
  });
  test('gap of exactly 10 minutes skips the speed check', () => {
    expect(evaluateFix(fix({ ts: 600_000, lng: EAST_1KM }), exactPrev(0))).toEqual({
      accepted: true,
      bucket: 'vehicle',
    });
  });
  test('rejects a 300 km move just under 10 minutes', () => {
    expect(evaluateFix(fix({ ts: 599_999, lat: LAT + 2.7 }), exactPrev(0))).toEqual({
      accepted: false,
      reason: 'speed',
    });
  });
});

describe('speed bucket', () => {
  test('falls back to computed speed when reported speed is negative', () => {
    // 1081 m in 599 s is ~6.5 km/h
    expect(evaluateFix(fix({ ts: 599_000, lng: EAST_1KM, speed: -1 }), exactPrev(0))).toEqual({
      accepted: true,
      bucket: 'walk',
    });
  });
  test('prefers reported speed over computed speed', () => {
    expect(evaluateFix(fix({ ts: 60_000, lng: EAST_1KM, speed: 1.2 }), exactPrev(0))).toEqual({
      accepted: true,
      bucket: 'walk',
    });
  });
});

describe('cell-only previous point (after relaunch)', () => {
  const cell = latLngToCell(LAT, LNG, H3_RES);
  const neighbour = gridDisk(cell, 1).find((c) => c !== cell)!;
  const [nLat, nLng] = cellToLatLng(neighbour);
  const [cLat, cLng] = cellToLatLng(cell);

  test('accepts a neighbouring-cell fix 1 s later (lower-bound distance)', () => {
    expect(evaluateFix(fix({ ts: 1_000, lat: nLat, lng: nLng }), { cell, ts: 0 }).accepted).toBe(true);
  });
  test('the same move with exact coordinates would be rejected', () => {
    const prev: LastPoint = { cell, ts: 0, lat: cLat, lng: cLng };
    expect(evaluateFix(fix({ ts: 1_000, lat: nLat, lng: nLng }), prev)).toEqual({
      accepted: false,
      reason: 'speed',
    });
  });
});
