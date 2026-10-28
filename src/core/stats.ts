import { UNITS, cellArea } from 'h3-js';
import type { TrackingMode } from './types';

export function areaKm2(cells: Iterable<string>): number {
  let total = 0;
  for (const c of cells) total += cellArea(c, UNITS.km2);
  return total;
}

export function startOfLocalDay(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Weeks start on Monday. */
export function startOfLocalWeek(nowMs: number): number {
  const d = new Date(startOfLocalDay(nowMs));
  const daysSinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - daysSinceMonday);
  return d.getTime();
}

/** level is 0–1; a negative level means the platform could not read it. */
export type BatterySample = { ts: number; level: number; mode: TrackingMode };

/** Average battery drain in % per hour for each tracking mode, or null with no data. */
export function batteryRatePerHour(
  samples: readonly BatterySample[],
): Record<TrackingMode, number | null> {
  const drop: Record<TrackingMode, number> = { efficient: 0, precise: 0 };
  const hours: Record<TrackingMode, number> = { efficient: 0, precise: 0 };
  const valid = samples.filter((s) => s.level >= 0).sort((a, b) => a.ts - b.ts);

  for (let i = 1; i < valid.length; i++) {
    const a = valid[i - 1]!;
    const b = valid[i]!;
    // Skip mode switches and charging; neither says anything about drain.
    if (a.mode !== b.mode || b.level > a.level) continue;
    drop[a.mode] += (a.level - b.level) * 100;
    hours[a.mode] += (b.ts - a.ts) / 3_600_000;
  }

  const rate = (m: TrackingMode) => (hours[m] > 0 ? drop[m] / hours[m] : null);
  return { efficient: rate('efficient'), precise: rate('precise') };
}
