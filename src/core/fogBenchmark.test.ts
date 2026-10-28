import { runFogBenchmark } from './fogBenchmark';

const BANGKOK = { lat: 13.7563, lng: 100.5018 };

test('times buildFog once per size with the given clock', () => {
  let t = 0;
  const now = () => (t += 7);
  const rows = runFogBenchmark([100, 500], BANGKOK, now);
  expect(rows.map((r) => r.cells)).toEqual([100, 500]);
  expect(rows.map((r) => r.ms)).toEqual([7, 7]);
  for (const r of rows) {
    expect(r.polygons).toBeGreaterThanOrEqual(1);
    expect(r.vertices).toBeGreaterThan(5); // at least the world ring
  }
});
