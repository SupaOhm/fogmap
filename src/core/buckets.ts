import { CYCLE_MAX_KMH, WALK_MAX_KMH } from './constants';
import type { SpeedBucket } from './types';

const ORDER: Record<SpeedBucket, number> = { walk: 0, cycle: 1, vehicle: 2 };

export function speedBucket(kmh: number): SpeedBucket {
  if (kmh <= WALK_MAX_KMH) return 'walk';
  if (kmh <= CYCLE_MAX_KMH) return 'cycle';
  return 'vehicle';
}

/** A cell keeps the slowest mode it was ever revealed in. */
export function slowerBucket(a: SpeedBucket, b: SpeedBucket): SpeedBucket {
  return ORDER[a] <= ORDER[b] ? a : b;
}
