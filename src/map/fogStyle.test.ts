import { BANGKOK } from '../config';
import { FINE_FOG_PAINT } from './fogStyle';

// MapLibre's zoom 0 is one 512-px tile: 40_075_016.686 m / 512 px at the equator.
const M_PER_PX_Z0 = 78_271.517 * Math.cos((BANGKOK.lat * Math.PI) / 180);

test('fine fog radius is an exponential-2 ramp that is constant on the ground', () => {
  const radius = FINE_FOG_PAINT['heatmap-radius'] as unknown[];
  expect(radius.slice(0, 3)).toEqual(['interpolate', ['exponential', 2], ['zoom']]);
  expect(radius[3]).toBe(0);
  expect(radius[5]).toBe(22);
  expect(radius[6]).toBeCloseTo((radius[4] as number) * 2 ** 22, 6);
});

test('the radius at zoom 15 is three sigma (0.6 cell spacings) in metres', () => {
  const radius = FINE_FOG_PAINT['heatmap-radius'] as number[];
  const px15 = radius[4] * 2 ** 15;
  const spacing = Math.sqrt((2 * 17_880) / Math.sqrt(3));
  expect((px15 * M_PER_PX_Z0) / 2 ** 15).toBeCloseTo(3 * 0.6 * spacing, 3);
});
