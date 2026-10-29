import { processFixes } from '../core/pipeline';
import { stressCells } from '../core/stress';
import type { Fix, RevealedCell } from '../core/types';
import { upsertCells } from './cells';
import { emitCellsChanged } from './events';
import type { Db } from './types';

const STRESS_SEED = 1;

export type ImportResult = { fixes: number; accepted: number; cells: number };

/**
 * Debug → GPX import. Same pipeline as live tracking, but with no previous point,
 * and it writes cells only: no track_log rows and no saved previous point, so
 * imported (possibly old) times cannot disturb live tracking or battery stats.
 */
export async function importFixes(db: Db, fixes: readonly Fix[]): Promise<ImportResult> {
  const { cells, logRows } = processFixes(fixes, null);
  if (cells.size > 0) {
    await db.withExclusiveTransactionAsync((txn) => upsertCells(txn, cells));
    emitCellsChanged();
  }
  return {
    fixes: fixes.length,
    accepted: logRows.filter((r) => r.accepted).length,
    cells: cells.size,
  };
}

/** Debug → stress fill: count road-like cells around origin, for the fog benchmark. */
export async function stressFill(
  db: Db,
  count: number,
  nowMs: number,
  origin: { lat: number; lng: number },
): Promise<number> {
  const cells = new Map<string, RevealedCell>();
  for (const h3 of stressCells(count, STRESS_SEED, origin)) {
    cells.set(h3, { bucket: 'walk', firstTs: nowMs, lastTs: nowMs });
  }
  await db.withExclusiveTransactionAsync((txn) => upsertCells(txn, cells));
  emitCellsChanged();
  return cells.size;
}

/** Debug → reset all data. */
export async function resetAllData(db: Db): Promise<void> {
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.execAsync('DELETE FROM cells; DELETE FROM track_log; DELETE FROM settings;');
  });
  emitCellsChanged('reset');
}
