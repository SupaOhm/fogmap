import { gridDisk, latLngToCell } from 'h3-js';
import { H3_RES, REVEAL_RADIUS } from './constants';
import { persistable, processFixes } from './pipeline';
import { pathCells } from './reveal';
import type { Fix } from './types';

const LAT = 13.756312345;
const LNG = 100.501812345;

function fix(over: Partial<Fix> = {}): Fix {
  return { ts: 0, lat: LAT, lng: LNG, accuracy: 10, speed: null, ...over };
}

const cellAt = (lat: number, lng: number) => latLngToCell(lat, lng, H3_RES);

test('no fixes changes nothing', () => {
  const r = processFixes([], null);
  expect(r.cells.size).toBe(0);
  expect(r.logRows).toEqual([]);
  expect(r.nextLastPoint).toBeNull();
});

test('a single fix reveals its cell and the rings around it', () => {
  const r = processFixes([fix()], null);
  expect(new Set(r.cells.keys())).toEqual(new Set(gridDisk(cellAt(LAT, LNG), REVEAL_RADIUS)));
  for (const v of r.cells.values()) {
    expect(v).toEqual({ bucket: 'vehicle', firstTs: 0, lastTs: 0 });
  }
  expect(r.logRows).toEqual([{ ts: 0, accuracy: 10, speed: null, accepted: true, rejectReason: null }]);
  expect(r.nextLastPoint).toEqual({ cell: cellAt(LAT, LNG), ts: 0, lat: LAT, lng: LNG });
});

test('two fixes within limits reveal the corridor between them', () => {
  const end = fix({ ts: 300_000, lng: LNG + 0.01 });
  const r = processFixes([fix(), end], null);
  for (const c of pathCells(cellAt(LAT, LNG), cellAt(end.lat, end.lng), true)) {
    expect(r.cells.has(c)).toBe(true);
  }
  expect(r.cells.size).toBeGreaterThan(38);
});

test('a jump beyond the limits is not filled', () => {
  const far = fix({ ts: 1_800_000, lng: LNG + 0.05 }); // ~5.4 km, 30 min
  const r = processFixes([fix(), far], null);
  expect(r.cells.size).toBe(38);
});

test('rejected fixes are logged with a reason and do not move the previous point', () => {
  const r = processFixes(
    [fix(), fix({ ts: 1_000, accuracy: 80 }), fix({ ts: 2_000, lng: LNG + 0.0001 })],
    null,
  );
  expect(r.logRows.map((l) => [l.accepted, l.rejectReason])).toEqual([
    [true, null],
    [false, 'accuracy'],
    [true, null],
  ]);
  expect(r.nextLastPoint?.ts).toBe(2_000);
});

test('fixes are processed in time order', () => {
  const r = processFixes([fix({ ts: 2_000 }), fix({ ts: 1_000 })], null);
  expect(r.logRows.map((l) => l.ts)).toEqual([1_000, 2_000]);
});

test('a cell revisited at walking speed is stored as walk', () => {
  const r = processFixes([fix({ speed: 20 }), fix({ ts: 60_000, speed: 1 })], null);
  const cell = r.cells.get(cellAt(LAT, LNG));
  expect(cell?.bucket).toBe('walk');
  expect(cell?.firstTs).toBe(0);
  expect(cell?.lastTs).toBe(60_000);
});

test('a slow visit is not overwritten by a later fast one', () => {
  const r = processFixes([fix({ speed: 1 }), fix({ ts: 60_000, speed: 20 })], null);
  expect(r.cells.get(cellAt(LAT, LNG))?.bucket).toBe('walk');
});

test('an invalid fix is rejected without losing the rest of the batch', () => {
  const run = () =>
    processFixes([fix(), fix({ ts: 1_000, lat: NaN }), fix({ ts: 2_000, lng: LNG + 0.0001 })], null);
  expect(run).not.toThrow();
  const r = run();
  expect(r.logRows.map((l) => l.rejectReason)).toEqual([null, 'invalid', null]);
  expect(r.nextLastPoint?.ts).toBe(2_000);
});

test('reveals after a long gap even if the implied speed is impossible', () => {
  const r = processFixes([fix(), fix({ ts: 13 * 3_600_000, lat: 51.47, lng: -0.4543 })], null);
  expect(r.logRows.every((l) => l.accepted)).toBe(true);
  expect(r.cells.size).toBe(38);
});

test('gap filling still works from a persisted (cell-only) previous point', () => {
  const first = processFixes([fix()], null);
  const restored = persistable(first.nextLastPoint!);
  const later = fix({ ts: 120_000, lng: LNG + 0.005 }); // ~540 m, 2 min
  const r = processFixes([later], restored);
  for (const c of pathCells(cellAt(LAT, LNG), cellAt(later.lat, later.lng), true)) {
    expect(r.cells.has(c)).toBe(true);
  }
});

test('nothing meant for disk contains coordinates', () => {
  const r = processFixes([fix(), fix({ ts: 60_000, lng: LNG + 0.001, speed: 1.5 })], null);
  const forDisk = JSON.stringify({
    cells: [...r.cells.entries()],
    logRows: r.logRows,
    lastPoint: persistable(r.nextLastPoint!),
  });
  expect(forDisk).not.toContain('13.7563');
  expect(forDisk).not.toContain('100.5018');
  expect(Object.keys(persistable(r.nextLastPoint!)).sort()).toEqual(['cell', 'ts']);
});
