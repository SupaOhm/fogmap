import { parseGpx } from './gpx';

const START = Date.UTC(2026, 9, 28, 1, 0, 0);

test('reads track points with times, in either attribute order', () => {
  const xml = `<?xml version="1.0"?><gpx><trk><trkseg>
    <trkpt lat="13.7563" lon="100.5018"><ele>2</ele><time>2026-10-28T01:00:00Z</time></trkpt>
    <trkpt lon="100.5118" lat="13.7563"><time>2026-10-28T01:10:00Z</time></trkpt>
  </trkseg></trk></gpx>`;
  expect(parseGpx(xml, 0)).toEqual([
    { ts: START, lat: 13.7563, lng: 100.5018, accuracy: 5, speed: null },
    { ts: START + 600_000, lat: 13.7563, lng: 100.5118, accuracy: 5, speed: null },
  ]);
});

test('synthesizes walking-pace times ending at endMs when any point lacks a time', () => {
  const xml = `<gpx><trk><trkseg>
    <trkpt lat="13.7563" lon="100.5018"><time>2026-10-28T01:00:00Z</time></trkpt>
    <trkpt lat="13.7563" lon="100.5118"/>
  </trkseg></trk></gpx>`;
  const end = 1_000_000_000;
  const fixes = parseGpx(xml, end);
  expect(fixes[1]!.ts).toBe(end);
  // ~1081 m at 5 km/h is ~778 s
  expect(end - fixes[0]!.ts).toBeGreaterThan(770_000);
  expect(end - fixes[0]!.ts).toBeLessThan(790_000);
});

test('reads route points and skips invalid coordinates', () => {
  const xml = `<gpx><rte>
    <rtept lat="13.7563" lon="100.5018"/>
    <rtept lat="abc" lon="100.5"/>
    <rtept lat="95" lon="100.5"/>
    <rtept lat="13.7600" lon="100.5100"/>
  </rte></gpx>`;
  expect(parseGpx(xml, 0).map((f) => [f.lat, f.lng])).toEqual([
    [13.7563, 100.5018],
    [13.76, 100.51],
  ]);
});

test('returns nothing for a file without points', () => {
  expect(parseGpx('<gpx></gpx>', 0)).toEqual([]);
});
