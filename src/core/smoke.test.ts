import { getResolution, isValidCell, latLngToCell } from 'h3-js';

test('h3-js produces a valid res-10 cell for Bangkok', () => {
  const cell = latLngToCell(13.7563, 100.5018, 10);
  expect(isValidCell(cell)).toBe(true);
  expect(getResolution(cell)).toBe(10);
});
