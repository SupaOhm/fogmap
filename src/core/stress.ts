import { latLngToCell } from 'h3-js';
import { H3_RES } from './constants';
import { expandCells } from './reveal';

const STEP_M = 100;
const M_PER_DEG_LAT = 111_320;
const MAX_TURN_RAD = 0.3;

/** Small seeded PRNG (mulberry32) so stress data is reproducible. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Road-like revealed cells for rendering benchmarks (Debug → stress fill). */
export function stressCells(count: number, seed: number, origin: { lat: number; lng: number }): string[] {
  const random = seededRandom(seed);
  const cells = new Set<string>();
  let { lat, lng } = origin;
  let heading = random() * 2 * Math.PI;

  while (cells.size < count) {
    heading += (random() * 2 - 1) * MAX_TURN_RAD;
    lat += (Math.cos(heading) * STEP_M) / M_PER_DEG_LAT;
    lng += (Math.sin(heading) * STEP_M) / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
    for (const c of expandCells([latLngToCell(lat, lng, H3_RES)])) cells.add(c);
  }
  return [...cells].slice(0, count);
}
