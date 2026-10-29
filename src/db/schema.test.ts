import { openNodeDb } from './testing/nodeDb';
import { MIGRATIONS, migrate } from './schema';
import type { Db } from './types';

async function version(db: Db): Promise<number> {
  return (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []))!.user_version;
}

async function columns(db: Db, table: string): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`, []);
  return rows.map((r) => r.name);
}

test('a fresh database gets every table and the latest version', async () => {
  const db = openNodeDb();
  await migrate(db);
  expect(await version(db)).toBe(MIGRATIONS.length);
  expect(await columns(db, 'cells')).toEqual(['h3', 'first_seen', 'last_seen', 'visit_count', 'mode']);
  expect(await columns(db, 'track_log')).toEqual([
    'ts',
    'accuracy',
    'speed',
    'accepted',
    'reject_reason',
    'tracking_mode',
    'battery',
    'charging',
  ]);
  expect(await columns(db, 'settings')).toEqual(['key', 'value']);
});

test('cells keep a rowid, which marks the order cells were first stored', async () => {
  const db = openNodeDb();
  await migrate(db);
  await db.runAsync("INSERT INTO cells VALUES ('b', 1, 1, 1, 'walk'), ('a', 1, 1, 1, 'walk')", []);
  const rows = await db.getAllAsync<{ h3: string }>('SELECT h3 FROM cells ORDER BY rowid', []);
  expect(rows.map((r) => r.h3)).toEqual(['b', 'a']);
});

test('migrating twice changes nothing', async () => {
  const db = openNodeDb();
  await migrate(db);
  await db.runAsync("INSERT INTO settings VALUES ('k', 'v')", []);
  await migrate(db);
  expect(await version(db)).toBe(MIGRATIONS.length);
  expect(await db.getAllAsync('SELECT * FROM settings', [])).toEqual([{ key: 'k', value: 'v' }]);
});

test('a failing migration rolls back and keeps the earlier version', async () => {
  const db = openNodeDb();
  await expect(migrate(db, [MIGRATIONS[0]!, 'CREATE TABLE broken (; nonsense'])).rejects.toThrow();
  expect(await version(db)).toBe(1);
  expect(await columns(db, 'broken')).toEqual([]);
});

test('no table has a coordinate column', async () => {
  const db = openNodeDb();
  await migrate(db);
  const tables = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
    [],
  );
  for (const { name } of tables) {
    for (const column of await columns(db, name)) {
      expect(column).not.toMatch(/lat|lng|lon|coord|geom|point/i);
    }
  }
});
