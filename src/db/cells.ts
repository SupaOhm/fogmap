import type { RevealedCell } from '../core/types';
import type { BindValue, Db } from './types';

// 4 bound values per row; 500 rows stays far below SQLite's variable limit.
const ROWS_PER_STATEMENT = 500;

// Same order as slowerBucket in src/core/buckets.ts: walk < cycle < vehicle.
const RANK = (col: string) => `CASE ${col} WHEN 'walk' THEN 0 WHEN 'cycle' THEN 1 ELSE 2 END`;

const UPSERT_TAIL = `
  ON CONFLICT (h3) DO UPDATE SET
    first_seen = MIN(cells.first_seen, excluded.first_seen),
    last_seen = MAX(cells.last_seen, excluded.last_seen),
    visit_count = cells.visit_count + 1,
    mode = CASE WHEN ${RANK('excluded.mode')} < ${RANK('cells.mode')} THEN excluded.mode ELSE cells.mode END`;

/**
 * Writes one batch of revealed cells. Does not open a transaction: callers wrap
 * it (with any other writes of the same batch) in withExclusiveTransactionAsync.
 */
export async function upsertCells(db: Db, cells: ReadonlyMap<string, RevealedCell>): Promise<void> {
  const entries = [...cells];
  for (let i = 0; i < entries.length; i += ROWS_PER_STATEMENT) {
    const chunk = entries.slice(i, i + ROWS_PER_STATEMENT);
    const params: BindValue[] = [];
    for (const [h3, c] of chunk) params.push(h3, c.firstTs, c.lastTs, c.bucket);
    const values = chunk.map(() => '(?, ?, ?, 1, ?)').join(', ');
    await db.runAsync(
      `INSERT INTO cells (h3, first_seen, last_seen, visit_count, mode) VALUES ${values} ${UPSERT_TAIL}`,
      params,
    );
  }
}

/**
 * Cells first stored after afterRowid, in insert order. An upsert keeps a cell's
 * rowid, so revisits are not returned again. Rowids can restart after a reset.
 */
export async function cellsAddedSince(
  db: Db,
  afterRowid: number,
): Promise<{ ids: string[]; lastRowid: number }> {
  const rows = await db.getAllAsync<{ rowid: number; h3: string }>(
    'SELECT rowid, h3 FROM cells WHERE rowid > ? ORDER BY rowid',
    [afterRowid],
  );
  const last = rows[rows.length - 1];
  return { ids: rows.map((r) => r.h3), lastRowid: last ? last.rowid : afterRowid };
}

export async function cellCount(db: Db): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM cells', []);
  return row?.n ?? 0;
}
