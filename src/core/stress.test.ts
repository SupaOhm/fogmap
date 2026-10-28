import { getResolution, isValidCell } from 'h3-js';
import { H3_RES } from './constants';
import { stressCells } from './stress';

const ORIGIN = { lat: 13.7563, lng: 100.5018 };

test('returns exactly the requested number of unique valid cells', () => {
  const cells = stressCells(2_000, 1, ORIGIN);
  expect(cells).toHaveLength(2_000);
  expect(new Set(cells).size).toBe(2_000);
  expect(cells.every((c) => isValidCell(c) && getResolution(c) === H3_RES)).toBe(true);
});

test('is deterministic for a seed', () => {
  expect(stressCells(500, 42, ORIGIN)).toEqual(stressCells(500, 42, ORIGIN));
  expect(stressCells(500, 42, ORIGIN)).not.toEqual(stressCells(500, 43, ORIGIN));
});
