import { latLngToCell } from 'h3-js';
import { slowerBucket } from './buckets';
import { H3_RES } from './constants';
import { evaluateFix } from './filter';
import { distanceFromPrevM } from './geo';
import { expandCells, pathCells, shouldFillGap } from './reveal';
import type { Fix, LastPoint, LogRow, SpeedBucket } from './types';

export type PipelineResult = {
  cells: Map<string, SpeedBucket>;
  logRows: LogRow[];
  nextLastPoint: LastPoint | null;
};

/**
 * Turns a batch of fixes into revealed cells and diagnostics. Shared by live
 * tracking and GPX import so both reveal exactly the same cells.
 */
export function processFixes(fixes: readonly Fix[], lastPoint: LastPoint | null): PipelineResult {
  const cells = new Map<string, SpeedBucket>();
  const logRows: LogRow[] = [];
  let prev = lastPoint;

  for (const fix of [...fixes].sort((x, y) => x.ts - y.ts)) {
    const verdict = evaluateFix(fix, prev);
    logRows.push({
      ts: fix.ts,
      accuracy: fix.accuracy,
      speed: fix.speed !== null && fix.speed >= 0 ? fix.speed : null,
      accepted: verdict.accepted,
      rejectReason: verdict.accepted ? null : verdict.reason,
    });
    if (!verdict.accepted) continue;

    const cell = latLngToCell(fix.lat, fix.lng, H3_RES);
    const fill =
      prev !== null && shouldFillGap(distanceFromPrevM(prev, fix.lat, fix.lng), fix.ts - prev.ts);
    for (const c of expandCells(pathCells(prev?.cell ?? null, cell, fill))) {
      const existing = cells.get(c);
      cells.set(c, existing ? slowerBucket(existing, verdict.bucket) : verdict.bucket);
    }
    prev = { cell, ts: fix.ts, lat: fix.lat, lng: fix.lng };
  }

  return { cells, logRows, nextLastPoint: prev };
}

/** The only form of a LastPoint that may be written to disk. */
export function persistable(point: LastPoint): { cell: string; ts: number } {
  return { cell: point.cell, ts: point.ts };
}
