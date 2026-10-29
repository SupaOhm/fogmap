// Writes a synthetic GPX track (no <time>, points 20–200 m apart) starting in
// Bangkok, for Debug → Import GPX. Usage: node scripts/make-test-gpx.mjs <out.gpx> [km=50] [seed=7]
import { writeFileSync } from 'node:fs';

const [, , out, kmArg = '50', seedArg = '7'] = process.argv;
if (!out) {
  console.error('usage: node scripts/make-test-gpx.mjs <out.gpx> [km=50] [seed=7]');
  process.exit(1);
}

const M_PER_DEG_LAT = 111_320;
const MAX_TURN_RAD = 0.25;

// mulberry32, as in src/core/stress.ts, so routes are reproducible.
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = seededRandom(Number(seedArg));
const targetM = Number(kmArg) * 1000;
let lat = 13.7563;
let lng = 100.5018;
let heading = random() * 2 * Math.PI;
let total = 0;
const points = [[lat, lng]];

while (total < targetM) {
  const step = 20 + random() * 180;
  heading += (random() * 2 - 1) * MAX_TURN_RAD;
  lat += (Math.cos(heading) * step) / M_PER_DEG_LAT;
  lng += (Math.sin(heading) * step) / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  total += step;
  points.push([lat, lng]);
}

const body = points
  .map(([a, b]) => `      <trkpt lat="${a.toFixed(6)}" lon="${b.toFixed(6)}"/>`)
  .join('\n');
writeFileSync(
  out,
  `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="fogmap make-test-gpx">
  <trk><name>fogmap test ${kmArg} km</name><trkseg>
${body}
  </trkseg></trk>
</gpx>
`,
);
console.log(`${points.length} points, ${(total / 1000).toFixed(1)} km -> ${out}`);
