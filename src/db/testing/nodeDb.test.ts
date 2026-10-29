import { openNodeDb } from './nodeDb';

test('runs statements and queries with bound values', async () => {
  const db = openNodeDb();
  await db.execAsync('CREATE TABLE t (k TEXT PRIMARY KEY, v INTEGER)');
  await db.runAsync('INSERT INTO t VALUES (?, ?)', ['a', 1]);
  await db.runAsync('INSERT INTO t VALUES (?, ?)', ['b', null]);
  expect(await db.getAllAsync('SELECT * FROM t ORDER BY k', [])).toEqual([
    { k: 'a', v: 1 },
    { k: 'b', v: null },
  ]);
  expect(await db.getFirstAsync('SELECT v FROM t WHERE k = ?', ['a'])).toEqual({ v: 1 });
  expect(await db.getFirstAsync('SELECT v FROM t WHERE k = ?', ['zzz'])).toBeNull();
});

test('an exclusive transaction commits on success and rolls back on error', async () => {
  const db = openNodeDb();
  await db.execAsync('CREATE TABLE t (k TEXT)');
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('INSERT INTO t VALUES (?)', ['kept']);
  });
  await expect(
    db.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync('INSERT INTO t VALUES (?)', ['dropped']);
      throw new Error('boom');
    }),
  ).rejects.toThrow('boom');
  expect(await db.getAllAsync('SELECT k FROM t', [])).toEqual([{ k: 'kept' }]);
});
