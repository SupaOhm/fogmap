import { speedBucket } from './buckets';
import { MAX_ACCURACY_M, MAX_SPEED_KMH } from './constants';
import { distanceFromPrevM } from './geo';
import type { Fix, FixVerdict, LastPoint } from './types';

function reportedSpeedKmh(fix: Fix): number | null {
  return fix.speed !== null && fix.speed >= 0 ? fix.speed * 3.6 : null;
}

export function evaluateFix(fix: Fix, prev: LastPoint | null): FixVerdict {
  if (fix.accuracy === null || fix.accuracy > MAX_ACCURACY_M) {
    return { accepted: false, reason: 'accuracy' };
  }
  let computedKmh: number | null = null;
  if (prev !== null) {
    // Clamp to 1 ms so a same-timestamp fix only passes if it hasn't moved.
    const dtS = Math.max(fix.ts - prev.ts, 1) / 1000;
    computedKmh = (distanceFromPrevM(prev, fix.lat, fix.lng) / dtS) * 3.6;
    if (computedKmh > MAX_SPEED_KMH) return { accepted: false, reason: 'speed' };
  }
  return { accepted: true, bucket: speedBucket(reportedSpeedKmh(fix) ?? computedKmh ?? 0) };
}
