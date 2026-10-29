/** H3 resolution for stored cells (~76 m average edge; ~83 m near Bangkok). */
export const H3_RES = 10;
/** Each revealed path cell also reveals neighbours within this many rings (2 → corridor ~650 m wide at res 10). */
export const REVEAL_RADIUS = 2;
/** Fixes with worse horizontal accuracy are dropped. */
export const MAX_ACCURACY_M = 50;
/** Fixes implying a faster speed from the previous accepted fix are dropped. */
export const MAX_SPEED_KMH = 300;
/** Gaps are filled only when shorter than this distance... */
export const GAP_MAX_M = 2000;
/** ...and shorter than this duration. */
export const GAP_MAX_MS = 10 * 60 * 1000;
/** Speed buckets: walk <= WALK_MAX_KMH < cycle <= CYCLE_MAX_KMH < vehicle. */
export const WALK_MAX_KMH = 8;
export const CYCLE_MAX_KMH = 25;
