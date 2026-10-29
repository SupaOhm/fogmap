export type BindValue = string | number | null;

/**
 * The subset of expo-sqlite that the app uses. On device it wraps expo-sqlite
 * (open.ts); in tests it wraps node:sqlite (testing/nodeDb.ts).
 */
export interface Db {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: BindValue[]): Promise<void>;
  getAllAsync<T>(sql: string, params: BindValue[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params: BindValue[]): Promise<T | null>;
  /** Queries inside the task must use txn, not the outer Db. Rolls back if the task throws. */
  withExclusiveTransactionAsync(task: (txn: Db) => Promise<void>): Promise<void>;
}
