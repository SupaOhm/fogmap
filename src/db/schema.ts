import type { Db } from './types';

/**
 * Ordered migrations; index i upgrades user_version i to i + 1. Never edit a
 * shipped migration; append a new one. No table may hold coordinates.
 */
export const MIGRATIONS: readonly string[] = [
  `
  -- cells keeps its rowid: the map reads newly stored cells by rowid (cellsAddedSince).
  CREATE TABLE cells (
    h3 TEXT PRIMARY KEY NOT NULL,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    visit_count INTEGER NOT NULL,
    mode TEXT NOT NULL
  );
  CREATE INDEX cells_first_seen ON cells (first_seen);
  CREATE TABLE track_log (
    ts INTEGER NOT NULL,
    accuracy REAL,
    speed REAL,
    accepted INTEGER NOT NULL,
    reject_reason TEXT,
    tracking_mode TEXT NOT NULL,
    battery REAL,
    charging INTEGER
  );
  CREATE INDEX track_log_ts ON track_log (ts);
  CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  ) WITHOUT ROWID;
  `,
];

export async function migrate(db: Db, migrations: readonly string[] = MIGRATIONS): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  for (let v = row?.user_version ?? 0; v < migrations.length; v++) {
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync(migrations[v]!);
      await txn.execAsync(`PRAGMA user_version = ${v + 1}`);
    });
  }
}
