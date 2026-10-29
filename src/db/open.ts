import { type SQLiteDatabase, openDatabaseSync } from 'expo-sqlite';
import { migrate } from './schema';
import type { BindValue, Db } from './types';

const DB_NAME = 'fogmap.db';

function wrap(d: SQLiteDatabase): Db {
  return {
    execAsync: (sql) => d.execAsync(sql),
    runAsync: async (sql, params) => {
      await d.runAsync(sql, params);
    },
    getAllAsync: <T>(sql: string, params: BindValue[]) => d.getAllAsync<T>(sql, params),
    getFirstAsync: <T>(sql: string, params: BindValue[]) => d.getFirstAsync<T>(sql, params),
    withExclusiveTransactionAsync: (task) => d.withExclusiveTransactionAsync((txn) => task(wrap(txn))),
  };
}

let dbPromise: Promise<Db> | null = null;

/** The one shared connection (UI and, in Plan 3, the background task), in WAL mode and migrated. */
export function getDb(): Promise<Db> {
  dbPromise ??= (async () => {
    const db = wrap(openDatabaseSync(DB_NAME));
    await db.execAsync('PRAGMA journal_mode = WAL');
    await migrate(db);
    return db;
  })().catch((e: unknown) => {
    dbPromise = null; // let the next call retry
    throw e;
  });
  return dbPromise;
}
