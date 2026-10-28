import { distanceM } from './geo';
import type { Fix } from './types';

const POINT_RE = /<(trkpt|rtept)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
const TIME_RE = /<time>([^<]+)<\/time>/;
const GPX_ACCURACY_M = 5;
const WALK_MPS = 5 / 3.6;

function numericAttr(attrs: string, name: string): number {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`).exec(attrs);
  return m ? Number(m[1]) : NaN;
}

/**
 * Dev-only GPX reader. Uses <time> when every point has one; otherwise spaces
 * points at walking pace from startMs so gap filling behaves like a walk.
 */
export function parseGpx(xml: string, startMs: number): Fix[] {
  const points: Array<{ lat: number; lng: number; time: number }> = [];
  for (const m of xml.matchAll(POINT_RE)) {
    const attrs = m[2] ?? '';
    const lat = numericAttr(attrs, 'lat');
    const lng = numericAttr(attrs, 'lon');
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      continue;
    }
    const timeText = TIME_RE.exec(m[3] ?? '')?.[1];
    points.push({ lat, lng, time: timeText ? Date.parse(timeText) : NaN });
  }

  const hasTimes = points.length > 0 && points.every((p) => Number.isFinite(p.time));
  let synthetic = startMs;
  return points.map((p, i) => {
    const q = points[i - 1];
    if (!hasTimes && q) synthetic += (distanceM(q.lat, q.lng, p.lat, p.lng) / WALK_MPS) * 1000;
    return {
      ts: hasTimes ? p.time : Math.round(synthetic),
      lat: p.lat,
      lng: p.lng,
      accuracy: GPX_ACCURACY_M,
      speed: null,
    };
  });
}
