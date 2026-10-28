import { speedBucket } from "./buckets";
import { GAP_MAX_MS, MAX_ACCURACY_M, MAX_SPEED_KMH } from "./constants";
import { distanceFromPrevM } from "./geo";
import type { Fix, FixVerdict, LastPoint } from "./types";

function reportedSpeedKmh(fix: Fix): number | null {
  return fix.speed !== null && fix.speed >= 0 ? fix.speed * 3.6 : null;
}

export function evaluateFix(fix: Fix, prev: LastPoint | null): FixVerdict {
  // On iOS a negative accuracy means the coordinates are invalid.
  if (
    !Number.isFinite(fix.accuracy) ||
    fix.accuracy === null ||
    fix.accuracy < 0 ||
    fix.accuracy > MAX_ACCURACY_M
  ) {
    return { accepted: false, reason: "accuracy" };
  }
  if (
    !Number.isFinite(fix.lat) ||
    !Number.isFinite(fix.lng) ||
    Math.abs(fix.lat) > 90 ||
    Math.abs(fix.lng) > 180
  ) {
    return { accepted: false, reason: "invalid" };
  }
  if (prev !== null && fix.ts < prev.ts)
    return { accepted: false, reason: "stale" };

  // Gaps this long are never filled, so they get no speed check either
  // (otherwise a flight would lock out reveals for hours).
  let computedKmh: number | null = null;
  if (prev !== null && fix.ts - prev.ts < GAP_MAX_MS) {
    // Clamp to 1 ms so a same-timestamp fix only passes if it hasn't moved.
    const dtS = Math.max(fix.ts - prev.ts, 1) / 1000;
    computedKmh = (distanceFromPrevM(prev, fix.lat, fix.lng) / dtS) * 3.6;
    if (computedKmh > MAX_SPEED_KMH)
      return { accepted: false, reason: "speed" };
  }
  // Unknown speed defaults to the fastest bucket: a cell keeps the slowest bucket it ever had.
  const kmh = reportedSpeedKmh(fix) ?? computedKmh;
  return {
    accepted: true,
    bucket: kmh === null ? "vehicle" : speedBucket(kmh),
  };
}
