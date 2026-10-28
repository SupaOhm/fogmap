import { gridDisk, gridPathCells } from 'h3-js';
import { GAP_MAX_M, GAP_MAX_MS, REVEAL_RADIUS } from './constants';

/** Larger gaps are treated as jumps (flights, tracking outages) and not filled. */
export function shouldFillGap(distanceM: number, dtMs: number): boolean {
  return distanceM < GAP_MAX_M && dtMs < GAP_MAX_MS;
}

/** Cells from `from` to `to` inclusive when filling, otherwise just `to`. */
export function pathCells(from: string | null, to: string, fill: boolean): string[] {
  if (from === null || !fill || from === to) return [to];
  try {
    return gridPathCells(from, to);
  } catch {
    // gridPathCells fails near pentagons or across some icosahedron faces;
    // treat that like a jump rather than losing the fix.
    return [to];
  }
}

export function expandCells(cells: Iterable<string>, radius: number = REVEAL_RADIUS): Set<string> {
  const out = new Set<string>();
  for (const cell of cells) {
    for (const c of gridDisk(cell, radius)) out.add(c);
  }
  return out;
}
