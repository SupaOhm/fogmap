/** One location reading. ts: ms since epoch. speed: m/s; null or negative means unknown. */
export type Fix = {
  ts: number;
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
};

export type SpeedBucket = 'walk' | 'cycle' | 'vehicle';

export type RejectReason = 'accuracy' | 'invalid' | 'stale' | 'speed';

/** One cell revealed by a batch: slowest bucket, and the earliest/latest fix time that revealed it. */
export type RevealedCell = { bucket: SpeedBucket; firstTs: number; lastTs: number };

/**
 * The previous accepted point. lat/lng exist only in memory; after a relaunch
 * only cell and ts are available (see persistable() in pipeline.ts).
 */
export type LastPoint = { cell: string; ts: number; lat?: number; lng?: number };

export type FixVerdict =
  | { accepted: true; bucket: SpeedBucket }
  | { accepted: false; reason: RejectReason };

/** Diagnostics for track_log. Deliberately has no coordinates. */
export type LogRow = {
  ts: number;
  accuracy: number | null;
  speed: number | null;
  accepted: boolean;
  rejectReason: RejectReason | null;
};

export type TrackingMode = 'efficient' | 'precise';
