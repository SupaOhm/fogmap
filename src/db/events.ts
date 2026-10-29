/** 'reset': rows were deleted, so rowids may start again from 1. */
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
  for (const listener of [...listeners]) listener(change);
}
