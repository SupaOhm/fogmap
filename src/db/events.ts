/**
 * 'reset': rows were deleted, so rowids may start again from 1. Any future delete of
 * cells must emit 'reset', because SQLite reuses rowids once the highest rows are gone.
 */
export type CellsChange = 'added' | 'reset';

type Listener = (change: CellsChange) => void;

const listeners = new Set<Listener>();

/** In-process notice that the cells table changed (GPX import, stress fill, reset; tracking in Plan 3). */
export function onCellsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitCellsChanged(change: CellsChange = 'added'): void {
  const errors: unknown[] = [];
  for (const listener of [...listeners]) {
    try {
      listener(change);
    } catch (e) {
      errors.push(e);
    }
  }
  // One bad listener must not starve the others, but the failure must not be silent.
  if (errors.length > 0) throw errors[0];
}
