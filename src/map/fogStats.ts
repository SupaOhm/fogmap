/** One fog refresh: JS time spent, cells added by it, total cells afterwards. */
export type FogBuild = { ms: number; added: number; cells: number; at: number };

let lastBuild: FogBuild | null = null;
let lastError: string | null = null;
const listeners = new Set<() => void>();

/** In-process notice that the stats changed, so the Debug tab shows them live. */
export function onFogStats(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/** Shown on the Debug tab: how long the last fog refresh took. */
export function recordFogBuild(build: FogBuild): void {
  lastBuild = build;
  lastError = null;
  notify();
}

export function recordFogError(e: unknown): void {
  lastError = e instanceof Error ? e.message : String(e);
  notify();
}

export function fogStats(): { lastBuild: FogBuild | null; lastError: string | null } {
  return { lastBuild, lastError };
}
