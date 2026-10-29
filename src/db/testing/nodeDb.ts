import { DatabaseSync } from 'node:sqlite';
import type { BindValue, Db } from '../types';

/** In-memory Db for Jest. Never imported by app code (node:sqlite does not exist on device). */
export function openNodeDb(): Db {
  const raw = new DatabaseSync(':memory:');
  const db: Db = {
    async execAsync(sql) {
      raw.exec(sql);
    },
    async runAsync(sql, params) {
      raw.prepare(sql).run(...params);
    },
    async getAllAsync<T>(sql: string, params: BindValue[]) {
      return raw.prepare(sql).all(...params) as unknown as T[];
    },
    async getFirstAsync<T>(sql: string, params: BindValue[]) {
      return (raw.prepare(sql).get(...params) as unknown as T | undefined) ?? null;
    },
    async withExclusiveTransactionAsync(task) {
      raw.exec('BEGIN EXCLUSIVE');
      try {
        await task(db);
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return db;
}
