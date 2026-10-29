import type { RevealedCell } from '../core/types';
import { cellCount, cellsAddedSince, upsertCells } from './cells';
import { migrate } from './schema';
import { openNodeDb } from './testing/nodeDb';
import type { Db } from './types';

type Row = { h3: string; first_seen: number; last_seen: number; visit_count: number; mode: string };

async function freshDb(): Promise<Db> {
  const db = openNodeDb();
  await migrate(db);
  return db;
}

async function row(db: Db, h3: string): Promise<Row | null> {
  return db.getFirstAsync<Row>('SELECT * FROM cells WHERE h3 = ?', [h3]);
}

const cell = (bucket: RevealedCell['bucket'], firstTs: number, lastTs: number): RevealedCell => ({
  bucket,
  firstTs,
  lastTs,
});

test('inserts new cells with visit_count 1', async () => {
  const db = await freshDb();
  await upsertCells(db, new Map([['a', cell('cycle', 100, 200)]]));
  expect(await row(db, 'a')).toEqual({ h3: 'a', first_seen: 100, last_seen: 200, visit_count: 1, mode: 'cycle' });
});

test('merges a later batch: earliest first_seen, latest last_seen, slowest mode', async () => {
  const db = await freshDb();
  await upsertCells(
    db,
    new Map([
      ['a', cell('walk', 100, 200)],
      ['b', cell('vehicle', 100, 200)],
    ]),
  );
  await upsertCells(
    db,
    new Map([
      ['a', cell('vehicle', 50, 150)],
      ['b', cell('cycle', 300, 400)],
    ]),
  );
  expect(await row(db, 'a')).toEqual({ h3: 'a', first_seen: 50, last_seen: 200, visit_count: 2, mode: 'walk' });
  expect(await row(db, 'b')).toEqual({ h3: 'b', first_seen: 100, last_seen: 400, visit_count: 2, mode: 'cycle' });
});

test('writes batches larger than one statement', async () => {
  const db = await freshDb();
  const many = new Map<string, RevealedCell>();
  for (let i = 0; i < 1234; i++) many.set(`c${String(i).padStart(4, '0')}`, cell('walk', i, i));
  await upsertCells(db, many);
  expect(await cellCount(db)).toBe(1234);
  expect(await row(db, 'c1233')).toEqual({ h3: 'c1233', first_seen: 1233, last_seen: 1233, visit_count: 1, mode: 'walk' });
});

test('an empty batch is a no-op', async () => {
  const db = await freshDb();
  await upsertCells(db, new Map());
  expect(await cellCount(db)).toBe(0);
});

test('cellsAddedSince returns new cells in insert order, not revisited ones', async () => {
  const db = await freshDb();
  await upsertCells(
    db,
    new Map([
      ['b', cell('walk', 1, 1)],
      ['a', cell('walk', 1, 1)],
    ]),
  );
  const first = await cellsAddedSince(db, 0);
  expect(first.ids).toEqual(['b', 'a']);
  await upsertCells(
    db,
    new Map([
      ['a', cell('walk', 2, 2)],
      ['c', cell('walk', 2, 2)],
    ]),
  );
  const second = await cellsAddedSince(db, first.lastRowid);
  expect(second.ids).toEqual(['c']);
  expect(await cellsAddedSince(db, second.lastRowid)).toEqual({ ids: [], lastRowid: second.lastRowid });
});
