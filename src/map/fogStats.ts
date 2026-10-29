/** One fog refresh: JS time spent, cells added by it, total cells afterwards. */
export type FogBuild = { ms: number; added: number; cells: number; at: number };

let lastBuild: FogBuild | null = null;
let lastError: string | null = null;

/** Shown on the Debug tab: how long the last fog refresh took. */
export function recordFogBuild(build: FogBuild): void {
  lastBuild = build;
  lastError = null;
}

export function recordFogError(e: unknown): void {
  lastError = e instanceof Error ? e.message : String(e);
}

export function fogStats(): { lastBuild: FogBuild | null; lastError: string | null } {
  return { lastBuild, lastError };
}
