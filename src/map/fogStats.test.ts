import { fogStats, onFogStats, recordFogBuild, recordFogError } from './fogStats';

test('keeps the last build and the last error until the next success', () => {
  expect(fogStats()).toEqual({ lastBuild: null, lastError: null });
  recordFogBuild({ ms: 12, added: 100, cells: 100, at: 1 });
  recordFogError(new Error('db closed'));
  expect(fogStats()).toEqual({ lastBuild: { ms: 12, added: 100, cells: 100, at: 1 }, lastError: 'db closed' });
  recordFogBuild({ ms: 15, added: 20, cells: 120, at: 2 });
  expect(fogStats()).toEqual({ lastBuild: { ms: 15, added: 20, cells: 120, at: 2 }, lastError: null });
  recordFogError('plain string');
  expect(fogStats().lastError).toBe('plain string');
});

test('onFogStats listeners hear builds and errors until they unsubscribe', () => {
  let heard = 0;
  const off = onFogStats(() => heard++);
  recordFogBuild({ ms: 1, added: 1, cells: 1, at: 1 });
  recordFogError('x');
  off();
  recordFogBuild({ ms: 1, added: 1, cells: 1, at: 2 });
  expect(heard).toBe(2);
});
