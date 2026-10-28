import { gridDisk, latLngToCell } from 'h3-js';
import { H3_RES } from './constants';
import { areaKm2, batteryRatePerHour, startOfLocalDay, startOfLocalWeek, type BatterySample } from './stats';

const HOUR = 3_600_000;

describe('areaKm2', () => {
  test('is 0 for no cells', () => {
    expect(areaKm2([])).toBe(0);
  });
  // Res-10 cells near Bangkok are ~0.0179 km² each, above the 0.0150 km² global average.
  test('7 res-10 cells near Bangkok cover about 0.125 km²', () => {
    const km2 = areaKm2(gridDisk(latLngToCell(13.7563, 100.5018, H3_RES), 1));
    expect(km2).toBeGreaterThan(0.11);
    expect(km2).toBeLessThan(0.14);
  });
});

describe('local time windows', () => {
  test('startOfLocalDay is local midnight', () => {
    expect(startOfLocalDay(new Date(2026, 9, 28, 15, 30).getTime())).toBe(
      new Date(2026, 9, 28).getTime(),
    );
  });
  test.each([
    ['Wednesday', new Date(2026, 9, 28, 9)],
    ['Monday itself', new Date(2026, 9, 26, 0, 0, 1)],
    ['Sunday', new Date(2026, 10, 1, 23)],
  ])('startOfLocalWeek from %s is Monday 26 Oct', (_, date) => {
    expect(startOfLocalWeek(date.getTime())).toBe(new Date(2026, 9, 26).getTime());
  });
});

describe('batteryRatePerHour', () => {
  test('computes % per hour per mode', () => {
    const samples: BatterySample[] = [
      { ts: 0, level: 1.0, mode: 'efficient' },
      { ts: HOUR, level: 0.95, mode: 'efficient' },
      { ts: 2 * HOUR, level: 0.9, mode: 'efficient' },
    ];
    const rate = batteryRatePerHour(samples);
    expect(rate.efficient).toBeCloseTo(5);
    expect(rate.precise).toBeNull();
  });
  test('ignores intervals where the level rose (charging)', () => {
    const samples: BatterySample[] = [
      { ts: 0, level: 0.5, mode: 'precise' },
      { ts: HOUR, level: 0.45, mode: 'precise' },
      { ts: 2 * HOUR, level: 0.8, mode: 'precise' },
      { ts: 3 * HOUR, level: 0.75, mode: 'precise' },
    ];
    expect(batteryRatePerHour(samples).precise).toBeCloseTo(5);
  });
  test('ignores intervals that span a mode switch and unknown levels', () => {
    const samples: BatterySample[] = [
      { ts: 0, level: 0.9, mode: 'efficient' },
      { ts: HOUR, level: 0.5, mode: 'precise' },
      { ts: 2 * HOUR, level: -1, mode: 'precise' },
      { ts: 3 * HOUR, level: 0.4, mode: 'precise' },
    ];
    const rate = batteryRatePerHour(samples);
    expect(rate.efficient).toBeNull();
    expect(rate.precise).toBeCloseTo(5);
  });
});
