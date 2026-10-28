import { runH3SelfCheck } from './h3SelfCheck';

test('every h3 self-check passes under Node', () => {
  const results = runH3SelfCheck();
  expect(results.map((r) => r.name)).toEqual([
    'latLngToCell',
    'gridDisk',
    'gridPathCells',
    'cellsToMultiPolygon',
    'cellArea',
  ]);
  for (const r of results) expect(r).toMatchObject({ ok: true });
});
