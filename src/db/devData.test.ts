import type { Fix } from '../core/types';
import { cellCount, cellsAddedSince } from './cells';
import { importFixes, resetAllData, stressFill } from './devData';
import { onCellsChanged } from './events';
import { migrate } from './schema';
import { openNodeDb } from './testing/nodeDb';
import type { Db } from './types';

const BANGKOK = { lat: 13.7563, lng: 100.5018 };

async function freshDb(): Promise<Db> {
  const db = openNodeDb();
  await migrate(db);
  return db;
}

const fix = (over: Partial<Fix> = {}): Fix => ({
  ts: 0,
  lat: BANGKOK.lat,
  lng: BANGKOK.lng,
  accuracy: 5,
  speed: null,
  ...over,
});

async function count(db: Db, table: string): Promise<number> {
  return (await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`, []))!.n;
}

test('importFixes reveals cells like live tracking, and writes nothing else', async () => {
  const db = await freshDb();
  let changes = 0;
  const off = onCellsChanged(() => changes++);
  const result = await importFixes(db, [
    fix(),
    fix({ ts: 60_000, lng: BANGKOK.lng + 0.001 }),
    fix({ ts: 120_000, accuracy: 100 }),
  ]);
  off();
  expect(result.fixes).toBe(3);
  expect(result.accepted).toBe(2);
  expect(result.cells).toBeGreaterThanOrEqual(7);
  expect(await cellCount(db)).toBe(result.cells);
  expect(await count(db, 'track_log')).toBe(0);
  expect(await count(db, 'settings')).toBe(0);
  expect(changes).toBe(1);
});

test('importFixes with nothing accepted writes nothing and does not notify', async () => {
  const db = await freshDb();
  let changes = 0;
  const off = onCellsChanged(() => changes++);
  const result = await importFixes(db, [fix({ accuracy: 100 })]);
  off();
  expect(result).toEqual({ fixes: 1, accepted: 0, cells: 0 });
  expect(await cellCount(db)).toBe(0);
  expect(changes).toBe(0);
});

test('stressFill writes exactly count cells as walk, stamped now', async () => {
  const db = await freshDb();
  const written = await stressFill(db, 1000, 5_000, BANGKOK);
  expect(written).toBe(1000);
  expect(await cellCount(db)).toBe(1000);
  expect(
    await db.getFirstAsync('SELECT MIN(first_seen) AS lo, MAX(last_seen) AS hi, COUNT(DISTINCT mode) AS modes, MIN(mode) AS mode FROM cells', []),
  ).toEqual({ lo: 5_000, hi: 5_000, modes: 1, mode: 'walk' });
});

test('resetAllData empties every table and notifies a reset', async () => {
  const db = await freshDb();
  await stressFill(db, 50, 0, BANGKOK);
  await db.runAsync(
    "INSERT INTO track_log (ts, accepted, tracking_mode) VALUES (1, 1, 'efficient')",
    [],
  );
  await db.runAsync("INSERT INTO settings VALUES ('tracking_enabled', '1')", []);
  const heard: string[] = [];
  const off = onCellsChanged((change) => heard.push(change));
  await resetAllData(db);
  off();
  expect([await count(db, 'cells'), await count(db, 'track_log'), await count(db, 'settings')]).toEqual([0, 0, 0]);
  expect(heard).toEqual(['reset']);
});

test('after a reset, rowids restart, so an old cursor would miss new cells', async () => {
  const db = await freshDb();
  await stressFill(db, 20, 0, BANGKOK);
  const before = await cellsAddedSince(db, 0);
  expect(before.ids).toHaveLength(20);
  await resetAllData(db);
  await stressFill(db, 3, 1, { lat: BANGKOK.lat + 1, lng: BANGKOK.lng });
  const fresh = await cellsAddedSince(db, 0);
  expect(fresh.ids).toHaveLength(3);
  expect(fresh.lastRowid).toBeLessThan(before.lastRowid);
  // Why listeners must restart from rowid 0 on 'reset'.
  expect((await cellsAddedSince(db, before.lastRowid)).ids).toEqual([]);
});
