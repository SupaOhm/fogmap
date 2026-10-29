# M1 Plan 2: Storage, Map and GPX Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revealed cells live in SQLite, the Map tab draws fog over a MapLibre map, and the Debug tab can import a GPX route, stress-fill 50,000 cells, benchmark the fog, and reset data. Fog performance is measured in a Release build before the map depends on it.

**Architecture:**
- `src/db/` talks to SQLite through a small `Db` interface. On device it wraps `expo-sqlite`; in Jest it wraps Node's built-in `node:sqlite`, so the real SQL runs in unit tests.
- GPX import and stress fill write cells through the same `upsertCells` that live tracking will use in Plan 3. An in-process event tells the map to refresh.
- The map keeps one `FogBuilder` alive (`FogSource`) and adds only cells stored since its last refresh, found by SQLite rowid. The first load is split into slices with a pause between them. Refreshes run at most once every 2 s and only while the app is in the foreground. (User decision after the Task 1 gate: a full rebuild of 50,000 cells takes ~7 s in Release, so updates are incremental and 50k-scale speed is deferred.)

**Tech Stack:** Expo SDK 58, expo-router 58 (JS tabs, `src/app/`), expo-sqlite 58, `@maplibre/maplibre-react-native` 11.5, expo-document-picker 58, expo-file-system 58, h3-js 4.5, Jest via jest-expo, `node:sqlite` (Node 25) for DB tests.

**Spec:** [docs/superpowers/specs/2026-10-28-milestone-1-design.md](../specs/2026-10-28-milestone-1-design.md)

**Not in this plan (Plan 3):** location permission, foreground and background tracking, tracking toggle, follow-me button, "Always" banner, `track_log` writes, `last_point` / `StoredPoint`, Stats tab, the tracking and battery parts of the Debug tab, `docs/m1-field-test.md`.

## Global Constraints

- Expo SDK 58. Install Expo-maintained packages with `npx expo install`, so versions match the SDK. Never hand-pick their versions.
- `@maplibre/maplibre-react-native` **11.x** (11.5.0 current). Use the v11 API only: `Map`, `Camera` (with `initialViewState`), `GeoJSONSource` (prop `data`), and `Layer` with `type` plus `paint`/`layout` (the `style` prop is deprecated). Coordinates are `[lng, lat]`. Bounds are `[west, south, east, north]`.
- Files in `src/core/` must not import `react`, `react-native`, or any `expo*` / `@maplibre*` package.
- Strict TypeScript. No `any` without a comment explaining why.
- No table has coordinate columns. Nothing in this plan writes `track_log` or the `last_point` setting.
- GPX import runs `processFixes(fixes, null)`, writes cells only, and places synthetic GPX times so the route ends at the import time.
- Schema exactly:
  - `cells(h3 TEXT PRIMARY KEY, first_seen INTEGER, last_seen INTEGER, visit_count INTEGER, mode TEXT)`
  - `track_log(ts INTEGER, accuracy REAL, speed REAL, accepted INTEGER, reject_reason TEXT, tracking_mode TEXT, battery REAL, charging INTEGER)`
  - `settings(key TEXT PRIMARY KEY, value TEXT)`
- Schema version lives in `PRAGMA user_version`. Migrations are ordered.
- Cell upsert rules:
  - insert: `first_seen = firstTs`, `last_seen = lastTs`, `visit_count = 1`;
  - on conflict: `first_seen = MIN(stored, new)`, `last_seen = MAX(stored, new)`, `visit_count + 1`, and `mode` = the slower of the stored and new bucket (`walk` < `cycle` < `vehicle`).
- Fog refresh runs at most once every **2 s**, and only in the foreground.
- Map style URL is `https://tiles.openfreemap.org/styles/liberty`.
- The Debug tab shows when `process.env.EXPO_PUBLIC_DEBUG_SCREEN !== '0'` (on by default).
- Stress fill default: **50,000** cells.
- Device: iPhone 14 "Hej", UDID `00008110-000A41CA3A39401E`, free Apple ID (team in `.env.local`). Release builds: `npx expo run:ios --device 00008110-000A41CA3A39401E --configuration Release`.
- `ios/` and `android/` are generated and never committed.
- Commit after each task.

## File Structure

| File | Responsibility |
|---|---|
| `src/core/fog.ts` (modify) | World ring at Web Mercator's limit, never shared between results; `cellsBounds` |
| `src/core/fogBenchmark.ts` | `runFogBenchmark`: times `buildFog` on stress data |
| `src/core/gpx.ts` (modify) | `parseGpx(xml, endMs)`: synthetic times end at `endMs` |
| `src/db/types.ts` | `Db` interface and `BindValue` |
| `src/db/testing/nodeDb.ts` | Test-only `Db` backed by `node:sqlite` in memory |
| `src/db/schema.ts` | `MIGRATIONS`, `migrate` |
| `src/db/open.ts` | `getDb()`: shared expo-sqlite connection, WAL, migrated |
| `src/db/cells.ts` | `upsertCells`, `cellsAddedSince`, `cellCount` |
| `src/db/events.ts` | `onCellsChanged`, `emitCellsChanged`, `CellsChange` (`'added'` or `'reset'`) |
| `src/db/devData.ts` | `importFixes`, `stressFill`, `resetAllData` (Debug tools) |
| `src/map/throttle.ts` | `createThrottle`: at most one run per interval, no overlap |
| `src/map/fogSource.ts` | `FogSource`: one long-lived `FogBuilder` fed only new cells, in slices |
| `src/map/fogStats.ts` | Last fog refresh: duration, cells added, total cells, for the Debug tab |
| `src/map/fogStyle.ts` | Fog fill and soft-edge paint |
| `src/map/useFog.ts` | Drives `FogSource` (throttled, foreground only) and exposes its result |
| `src/config.ts` | App constants: style URL, Bangkok, zoom, refresh interval, Debug flag, stress size |
| `src/screens/MapScreen.tsx` | Map with fog, km² chip, "Fit revealed" button |
| `src/screens/DebugScreen.tsx` | Cell count, fog timing, benchmark, GPX import, stress fill, reset, h3 self-check |
| `src/app/_layout.tsx`, `src/app/index.tsx`, `src/app/debug.tsx` | expo-router tabs (thin route files) |
| `index.ts` (modify) | Entry: `expo-router/entry` |
| `app.config.ts` (modify) | `scheme`, plugins |
| `scripts/make-test-gpx.mjs` | Writes a synthetic ~50 km GPX route for the device check |

Tests sit next to their files as `*.test.ts`. React components have no unit tests; they are checked by `npm run typecheck` and on the device.

---

### Task 1: Fog hardening and the Release benchmark gate

**Files:**
- Modify: `src/core/fog.ts`, `src/core/fog.test.ts`
- Create: `src/core/fogBenchmark.ts`, `src/core/fogBenchmark.test.ts`
- Modify: `App.tsx` (temporary screen; deleted in Task 6)
- Modify: `docs/superpowers/specs/2026-10-28-milestone-1-design.md` (record the measurement)

**Interfaces:**
- Consumes: `buildFog(cells: string[]): Feature<MultiPolygon>` and `stressCells(count, seed, origin)` from Plan 1.
- Produces:
  - `export type Bounds = [west: number, south: number, east: number, north: number]`
  - `export function cellsBounds(cells: readonly string[]): Bounds | null`
  - `export const WORLD_RING: readonly (readonly [number, number])[]`
  - `export type FogBenchmarkRow = { cells: number; ms: number; polygons: number; vertices: number }`
  - `export function runFogBenchmark(sizes: readonly number[], origin: { lat: number; lng: number }, now: () => number): FogBenchmarkRow[]`

- [ ] **Step 1: Write the failing fog tests**

Replace `src/core/fog.test.ts` with:

```ts
import { cellToLatLng, gridDisk, latLngToCell } from 'h3-js';
import { H3_RES } from './constants';
import { WORLD_RING, buildFog, cellsBounds } from './fog';

const centre = latLngToCell(13.7563, 100.5018, H3_RES);

test('no cells means the whole world is fog', () => {
  expect(buildFog([]).geometry.coordinates).toEqual([[WORLD_RING]]);
});

test("the world ring reaches Web Mercator's limit", () => {
  const lats = WORLD_RING.map(([, lat]) => lat);
  expect(Math.max(...lats)).toBeCloseTo(85.051129, 6);
  expect(Math.min(...lats)).toBeCloseTo(-85.051129, 6);
});

test('changing one result does not change the next', () => {
  const first = buildFog([]);
  first.geometry.coordinates[0]![0]![0]![0] = 0;
  expect(buildFog([]).geometry.coordinates).toEqual([[WORLD_RING]]);
});

test('one cell becomes one hexagonal hole', () => {
  const coords = buildFog([centre]).geometry.coordinates;
  expect(coords).toHaveLength(1);
  expect(coords[0]).toHaveLength(2);
  expect(coords[0]![1]).toHaveLength(7); // 6 vertices + closing point
});

test('an unrevealed cell surrounded by revealed cells stays fogged', () => {
  const ring = gridDisk(centre, 1).filter((c) => c !== centre);
  const coords = buildFog(ring).geometry.coordinates;
  expect(coords).toHaveLength(2);
  expect(coords[0]).toHaveLength(2); // world + outer edge of the ring
  expect(coords[1]).toHaveLength(1); // the island
  expect(coords[1]![0]).toHaveLength(7);
});

test('holes use GeoJSON [lng, lat] order', () => {
  const [lng, lat] = buildFog([centre]).geometry.coordinates[0]![1]![0]!;
  expect(lng).toBeCloseTo(100.5, 1);
  expect(lat).toBeCloseTo(13.76, 1);
});

describe('cellsBounds', () => {
  test('is null without cells', () => {
    expect(cellsBounds([])).toBeNull();
  });

  test('is the centre point for one cell, as [west, south, east, north]', () => {
    const [lat, lng] = cellToLatLng(centre);
    expect(cellsBounds([centre])).toEqual([lng, lat, lng, lat]);
  });

  test('covers every cell centre', () => {
    const far = latLngToCell(13.9, 100.7, H3_RES);
    const [west, south, east, north] = cellsBounds([centre, far])!;
    for (const c of [centre, far]) {
      const [lat, lng] = cellToLatLng(c);
      expect(lng).toBeGreaterThanOrEqual(west);
      expect(lng).toBeLessThanOrEqual(east);
      expect(lat).toBeGreaterThanOrEqual(south);
      expect(lat).toBeLessThanOrEqual(north);
    }
    expect(east - west).toBeGreaterThan(0.1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `rtk proxy npx jest src/core/fog.test.ts`
Expected: FAIL: `cellsBounds` is not a function, the Mercator test fails (85 vs 85.051129), and the "changing one result" test fails.

- [ ] **Step 3: Implement**

Replace `src/core/fog.ts` with:

```ts
import { cellToLatLng, cellsToMultiPolygon } from 'h3-js';
import type { Feature, MultiPolygon, Position } from 'geojson';

// Web Mercator's limit; MapLibre cannot show anything beyond it.
const MAX_LAT = 85.051129;

export const WORLD_RING: readonly (readonly [number, number])[] = [
  [-180, -MAX_LAT],
  [180, -MAX_LAT],
  [180, MAX_LAT],
  [-180, MAX_LAT],
  [-180, -MAX_LAT],
];

export type Bounds = [west: number, south: number, east: number, north: number];

/**
 * Fog as one world polygon with every revealed area as a hole. Unrevealed islands
 * inside a revealed area become separate polygons, since holes cannot nest.
 */
export function buildFog(cells: string[]): Feature<MultiPolygon> {
  const outerRings: Position[][] = [];
  const islands: Position[][][] = [];
  for (const [outer, ...inner] of cellsToMultiPolygon(cells, true)) {
    if (outer) outerRings.push(outer);
    for (const ring of inner) islands.push([ring]);
  }
  // A fresh copy of the world ring, so callers cannot change the shared one.
  const world: Position[] = WORLD_RING.map(([lng, lat]) => [lng, lat]);
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'MultiPolygon', coordinates: [[world, ...outerRings], ...islands] },
  };
}

/** Bounding box of the cell centres, or null without cells. Ignores the antimeridian. */
export function cellsBounds(cells: readonly string[]): Bounds | null {
  if (cells.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const c of cells) {
    const [lat, lng] = cellToLatLng(c);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return [west, south, east, north];
}
```

- [ ] **Step 4: Run the fog tests to verify they pass**

Run: `rtk proxy npx jest src/core/fog.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Write the failing benchmark test**

Create `src/core/fogBenchmark.test.ts`:

```ts
import { runFogBenchmark } from './fogBenchmark';

const BANGKOK = { lat: 13.7563, lng: 100.5018 };

test('times buildFog once per size with the given clock', () => {
  let t = 0;
  const now = () => (t += 7);
  const rows = runFogBenchmark([100, 500], BANGKOK, now);
  expect(rows.map((r) => r.cells)).toEqual([100, 500]);
  expect(rows.map((r) => r.ms)).toEqual([7, 7]);
  for (const r of rows) {
    expect(r.polygons).toBeGreaterThanOrEqual(1);
    expect(r.vertices).toBeGreaterThan(5); // at least the world ring
  }
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `rtk proxy npx jest src/core/fogBenchmark.test.ts`
Expected: FAIL: cannot find module `./fogBenchmark`.

- [ ] **Step 7: Implement**

Create `src/core/fogBenchmark.ts`:

```ts
import { buildFog } from './fog';
import { stressCells } from './stress';

export type FogBenchmarkRow = { cells: number; ms: number; polygons: number; vertices: number };

/**
 * Times buildFog on stress data of each size. now() is a millisecond clock
 * (performance.now on device). Generating the cells is not timed.
 */
export function runFogBenchmark(
  sizes: readonly number[],
  origin: { lat: number; lng: number },
  now: () => number,
): FogBenchmarkRow[] {
  return sizes.map((size) => {
    const cells = stressCells(size, 1, origin);
    const start = now();
    const fog = buildFog(cells);
    const ms = now() - start;
    const polygons = fog.geometry.coordinates;
    let vertices = 0;
    for (const polygon of polygons) for (const ring of polygon) vertices += ring.length;
    return { cells: cells.length, ms, polygons: polygons.length, vertices };
  });
}
```

- [ ] **Step 8: Run all tests and the typecheck**

Run: `rtk proxy npx jest && npm run typecheck`
Expected: all suites pass, typecheck clean.

- [ ] **Step 9: Add the benchmark to the temporary screen**

Replace `App.tsx` with:

```tsx
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Button, ScrollView, StyleSheet, Text } from 'react-native';
import { type FogBenchmarkRow, runFogBenchmark } from './src/core/fogBenchmark';
import { runH3SelfCheck } from './src/core/h3SelfCheck';

const isHermes =
  typeof (globalThis as { HermesInternal?: unknown }).HermesInternal !== 'undefined';
const results = runH3SelfCheck();
const BANGKOK = { lat: 13.7563, lng: 100.5018 };
const SIZES = [10_000, 25_000, 50_000];

export default function App() {
  const [bench, setBench] = useState<FogBenchmarkRow[] | null>(null);
  const [running, setRunning] = useState(false);

  const runBenchmark = () => {
    setRunning(true);
    // Let "Running…" render before the JS thread is blocked.
    setTimeout(() => {
      setBench(runFogBenchmark(SIZES, BANGKOK, () => performance.now()));
      setRunning(false);
    }, 50);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>h3-js self-check</Text>
      <Text>
        Engine: {isHermes ? 'Hermes' : 'NOT Hermes'} · Build: {__DEV__ ? 'Debug' : 'Release'}
      </Text>
      {results.map((r) => (
        <Text key={r.name} style={r.ok ? styles.ok : styles.fail}>
          {r.ok ? 'PASS' : 'FAIL'} {r.name}: {r.detail}
        </Text>
      ))}
      <Text style={styles.title}>Fog benchmark</Text>
      <Button title={running ? 'Running…' : 'Run 10k / 25k / 50k'} onPress={runBenchmark} disabled={running} />
      {bench?.map((r) => (
        <Text key={r.cells}>
          {r.cells.toLocaleString()} cells: {Math.round(r.ms)} ms, {r.polygons} polygons,{' '}
          {r.vertices.toLocaleString()} vertices
        </Text>
      ))}
      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 80, gap: 8 },
  title: { fontSize: 20, fontWeight: '600' },
  ok: { color: '#1a7f37' },
  fail: { color: '#cf222e', fontWeight: '600' },
});
```

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add src/core/fog.ts src/core/fog.test.ts src/core/fogBenchmark.ts src/core/fogBenchmark.test.ts App.tsx
git commit -m "feat(core): fog world ring at Mercator limit, cellsBounds, fog benchmark"
```

- [ ] **Step 11: Device gate (controller and user, not the implementer)**

1. Build and install a Release build: `npx expo run:ios --device 00008110-000A41CA3A39401E --configuration Release`. This build does not need Metro.
2. The user opens the app, checks that it says "Build: Release", taps "Run 10k / 25k / 50k", and sends a screenshot.
3. Add the numbers to the spec, under "Measured baseline" in "Fog performance", as a new bullet: `**Release build (YYYY-MM-DD, iPhone 14, Hermes):** buildFog 10k = … ms, 25k = … ms, 50k = … ms (… polygons, … vertices).` Commit with `docs(spec): record Release buildFog benchmark`.
4. **Gate:**
   - If 50,000 cells take **≤ 1,000 ms**, continue with Task 2.
   - If they take **more**, stop and report to the user before continuing. Chunking by parent cell has a visible side effect: the soft-edge line would also draw along every chunk boundary inside revealed areas. So it needs the user's decision, for example chunking without the soft edge, or accepting the delay. Then add the chosen task to this plan.

### Task 1b: Fast incremental fog builder (added after the Task 1 gate failed)

**Why:** On the iPhone (Release, Hermes) `buildFog` took 10,324 ms for 50,000 cells; nearly all of it is h3's `cellsToMultiPolygon`. This task replaces its internals with an edge-cancellation outline that needs one cheap h3 call per cell (`cellToVertexes`), can add cells incrementally, fixes nesting (a revealed spot inside an unrevealed island was fogged by the island polygon), and emits RFC 7946 winding (exterior rings counter-clockwise, holes clockwise). Callers of `buildFog` do not change.

**How it works:**
- Each cell's vertices come counter-clockwise from `cellToVertexes`, and neighbours share the same H3 vertex ids (both verified).
- Adding a cell adds its directed edges `from → to`. If the reverse edge `to → from` is already open, the two cancel, because it is a shared interior edge.
- What stays open is exactly the boundary of the revealed area. In a hex grid, three cells meet at every vertex, so each vertex has at most one open outgoing edge, and a `Map<from, to>` is enough.
- Following `next` pointers gives closed rings. Revealed outlines run counter-clockwise (positive area) and unrevealed islands clockwise.
- Each revealed outline becomes a hole in the innermost island that contains it, or in the world polygon if there is none.
- All found rings are reversed on output (RFC 7946 winding).
- In Node this matched `cellsToMultiPolygon` ring for ring (same vertex sets) on 10k and 50k stress cells.

**Files:**
- Modify: `src/core/fog.ts`, `src/core/fog.test.ts`

**Interfaces:**
- Keeps: `WORLD_RING`, `Bounds`, `cellsBounds` (unchanged).
- `buildFog(cells: Iterable<string>): Feature<MultiPolygon>`. The parameter widens from `string[]`; output structure is unchanged: `[[world, ...revealedHoles], ...islandPolygons]`.
- New:
  ```ts
  export class FogBuilder {
    get size(): number;                       // cells added so far
    add(cells: Iterable<string>): void;       // duplicates ignored
    reset(): void;
    toFeature(): Feature<MultiPolygon>;
  }
  ```

- [ ] **Step 1: Write the failing tests**

In `src/core/fog.test.ts`:
1. Change the h3 import to `import { cellToLatLng, cellsToMultiPolygon, gridDisk, latLngToCell } from 'h3-js';`.
2. Add `import type { Feature, MultiPolygon, Position } from 'geojson';` and `import { stressCells } from './stress';`.
3. Change the fog import to `import { FogBuilder, WORLD_RING, buildFog, cellsBounds } from './fog';`.
4. Add these helpers below `const centre = ...`:

```ts
const BANGKOK = { lat: 13.7563, lng: 100.5018 };

/** Order-independent key of a closed ring: its vertices, rounded and sorted. */
const ringKey = (ring: Position[]) =>
  ring
    .slice(0, -1)
    .map(([lng, lat]) => `${lng!.toFixed(7)},${lat!.toFixed(7)}`)
    .sort()
    .join(';');

/** Order-independent shape of a fog feature, for comparing builds. */
const shape = (f: Feature<MultiPolygon>) =>
  f.geometry.coordinates.map((polygon) => polygon.map(ringKey).join('|')).sort();

const signedArea = (ring: Position[]) => {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i]![0]! * ring[i + 1]![1]! - ring[i + 1]![0]! * ring[i]![1]!;
  }
  return a / 2;
};
```

5. Add these tests after `'holes use GeoJSON [lng, lat] order'`:

```ts
test('a revealed cell inside an unrevealed island is a hole in that island', () => {
  const inner = gridDisk(centre, 1);
  const revealed = [...gridDisk(centre, 2).filter((c) => !inner.includes(c)), centre];
  const coords = buildFog(revealed).geometry.coordinates;
  expect(coords).toHaveLength(2);
  expect(coords[0]).toHaveLength(2); // world + outer edge of the revealed ring
  expect(coords[1]).toHaveLength(2); // the unrevealed island, with the centre cell as its hole
  expect(coords[1]![1]).toHaveLength(7);
});

test('rings follow RFC 7946: exteriors counter-clockwise, holes clockwise', () => {
  const inner = gridDisk(centre, 1);
  const revealed = [...gridDisk(centre, 2).filter((c) => !inner.includes(c)), centre];
  for (const polygon of buildFog(revealed).geometry.coordinates) {
    expect(signedArea(polygon[0]!)).toBeGreaterThan(0);
    for (const hole of polygon.slice(1)) expect(signedArea(hole)).toBeLessThan(0);
  }
});

test('outlines match h3 cellsToMultiPolygon on a long route', () => {
  const cells = stressCells(10_000, 1, BANGKOK);
  const [[, ...holes], ...islands] = buildFog(cells).geometry.coordinates;
  const ours = [...holes!, ...islands.flat()];
  const reference = cellsToMultiPolygon(cells, true).flat();
  expect(ours.length).toBeGreaterThan(1); // the route has islands, so this is not trivial
  expect(ours).toHaveLength(reference.length);
  expect(new Set(ours.map(ringKey))).toEqual(new Set(reference.map(ringKey)));
});

describe('FogBuilder', () => {
  test('adding cells in batches gives the same fog as all at once', () => {
    const cells = stressCells(2000, 3, BANGKOK);
    const builder = new FogBuilder();
    builder.add(cells.slice(0, 700));
    builder.add(cells.slice(700));
    expect(builder.size).toBe(2000);
    expect(shape(builder.toFeature())).toEqual(shape(buildFog(cells)));
  });

  test('adding a cell twice changes nothing', () => {
    const builder = new FogBuilder();
    builder.add([centre]);
    builder.add([centre, centre]);
    expect(builder.size).toBe(1);
    expect(shape(builder.toFeature())).toEqual(shape(buildFog([centre])));
  });

  test('a later cell can fill an island', () => {
    const builder = new FogBuilder();
    builder.add(gridDisk(centre, 1).filter((c) => c !== centre));
    expect(builder.toFeature().geometry.coordinates).toHaveLength(2);
    builder.add([centre]);
    expect(builder.toFeature().geometry.coordinates).toHaveLength(1);
  });

  test('reset clears every cell', () => {
    const builder = new FogBuilder();
    builder.add(gridDisk(centre, 1));
    builder.reset();
    expect(builder.size).toBe(0);
    expect(builder.toFeature().geometry.coordinates).toEqual([[WORLD_RING]]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk proxy npx jest src/core/fog.test.ts`
Expected: FAIL. `FogBuilder` is not a constructor; the nesting test fails (the island has 1 ring, not 2); the RFC test fails (h3 holes are counter-clockwise).

- [ ] **Step 3: Implement**

In `src/core/fog.ts`:
- change the h3 import to `import { cellToLatLng, cellToVertexes, vertexToLatLng } from 'h3-js';`;
- keep `MAX_LAT`, `WORLD_RING`, `Bounds` and `cellsBounds` exactly as they are;
- replace the `buildFog` function and its doc comment with:

```ts
type LngLat = [number, number];
type Ring = { coords: LngLat[]; area: number; west: number; south: number; east: number; north: number };

/**
 * Fog outline built incrementally. Each revealed cell adds its edges (H3 gives
 * vertices counter-clockwise, and neighbours share vertex ids); an edge shared
 * with a revealed neighbour cancels out, so the open edges are exactly the
 * boundary of the revealed area. Needs one cheap h3 call per cell, unlike
 * cellsToMultiPolygon, which is ~10 s for 50k cells on Hermes. Ignores the antimeridian.
 */
export class FogBuilder {
  private readonly cells = new Set<string>();
  /** Open boundary edges, from vertex → to vertex. At most one per vertex: three cells meet at each. */
  private readonly edges = new Map<string, string>();
  private readonly vertexCoords = new Map<string, LngLat>();

  get size(): number {
    return this.cells.size;
  }

  add(cells: Iterable<string>): void {
    for (const cell of cells) {
      if (this.cells.has(cell)) continue;
      this.cells.add(cell);
      const vertices = cellToVertexes(cell);
      // Cancel shared edges first: a vertex briefly has two open edges otherwise,
      // depending on which edge of the cell comes first.
      const open: [string, string][] = [];
      for (let i = 0; i < vertices.length; i++) {
        const from = vertices[i]!;
        const to = vertices[(i + 1) % vertices.length]!;
        if (this.edges.get(to) === from) this.edges.delete(to);
        else open.push([from, to]);
      }
      for (const [from, to] of open) {
        if (this.edges.has(from)) throw new Error(`fog outline touches itself at vertex ${from}`);
        this.edges.set(from, to);
      }
    }
  }

  reset(): void {
    this.cells.clear();
    this.edges.clear();
    this.vertexCoords.clear();
  }

  /**
   * Fog as one world polygon with every revealed area as a hole; each unrevealed
   * island is its own polygon, with the revealed areas inside it as holes.
   * Exterior rings are counter-clockwise and holes clockwise (RFC 7946).
   */
  toFeature(): Feature<MultiPolygon> {
    const outlines: Ring[] = [];
    const islands: Ring[] = [];
    for (const ring of this.rings()) (ring.area > 0 ? outlines : islands).push(ring);

    const worldHoles: Position[][] = [];
    const islandHoles = islands.map((): Position[][] => []);
    for (const outline of outlines) {
      const i = innermostContaining(islands, outline.coords[0]!);
      (i === -1 ? worldHoles : islandHoles[i]!).push(reversedClosed(outline.coords));
    }

    // A fresh copy of the world ring, so callers cannot change the shared one.
    const world: Position[] = WORLD_RING.map(([lng, lat]) => [lng, lat]);
    return {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [world, ...worldHoles],
          ...islands.map((island, i) => [reversedClosed(island.coords), ...islandHoles[i]!]),
        ],
      },
    };
  }

  /** Follows the open edges into closed rings. Revealed outlines come out counter-clockwise, islands clockwise. */
  private rings(): Ring[] {
    const next = new Map(this.edges);
    const rings: Ring[] = [];
    for (const start of this.edges.keys()) {
      if (!next.has(start)) continue;
      const coords: LngLat[] = [];
      let v = start;
      do {
        coords.push(this.coord(v));
        const to = next.get(v);
        if (to === undefined) throw new Error(`fog outline is not closed at vertex ${v}`);
        next.delete(v);
        v = to;
      } while (v !== start);
      rings.push(measure(coords));
    }
    return rings;
  }

  private coord(vertex: string): LngLat {
    let c = this.vertexCoords.get(vertex);
    if (!c) {
      const [lat, lng] = vertexToLatLng(vertex);
      c = [lng, lat];
      this.vertexCoords.set(vertex, c);
    }
    return c;
  }
}

/** Fog for a set of revealed cells (see FogBuilder). */
export function buildFog(cells: Iterable<string>): Feature<MultiPolygon> {
  const builder = new FogBuilder();
  builder.add(cells);
  return builder.toFeature();
}

function measure(coords: LngLat[]): Ring {
  let twiceArea = 0;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (let i = 0; i < coords.length; i++) {
    const [x1, y1] = coords[i]!;
    const [x2, y2] = coords[(i + 1) % coords.length]!;
    twiceArea += x1 * y2 - x2 * y1;
    west = Math.min(west, x1);
    east = Math.max(east, x1);
    south = Math.min(south, y1);
    north = Math.max(north, y1);
  }
  return { coords, area: twiceArea / 2, west, south, east, north };
}

/** Index of the smallest island containing the point, or -1. Outlines never touch islands, so any vertex decides. */
function innermostContaining(islands: Ring[], [x, y]: LngLat): number {
  let best = -1;
  for (let i = 0; i < islands.length; i++) {
    const r = islands[i]!;
    if (x < r.west || x > r.east || y < r.south || y > r.north || !pointInRing(r.coords, x, y)) continue;
    if (best === -1 || Math.abs(r.area) < Math.abs(islands[best]!.area)) best = i;
  }
  return best;
}

function pointInRing(ring: LngLat[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The ring reversed (flips its winding) and closed with its first point. */
function reversedClosed(coords: LngLat[]): Position[] {
  const out: Position[] = coords.map(([lng, lat]) => [lng, lat]).reverse();
  out.push([...out[0]!]);
  return out;
}
```

If `cellsToMultiPolygon` is no longer used in `fog.ts`, it must not be imported there (it stays in the test as the reference).

- [ ] **Step 4: Run the tests**

Run: `rtk proxy npx jest src/core/fog.test.ts`, then `rtk proxy npx jest && npm run typecheck`.
Expected: all pass (16 tests in fog.test.ts), typecheck clean. `src/core/fogBenchmark.test.ts` must still pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/core/fog.ts src/core/fog.test.ts
git commit -m "perf(core): incremental edge-cancellation fog builder; nested islands, RFC 7946 winding"
```

- [ ] **Step 6: Device re-measure (controller and user)**

Release build, then run the same benchmark button. Record the numbers in the spec under the Task 1 Release line. Gate as in Task 1: if 50,000 cells take ≤ 1,000 ms, continue with Task 2; otherwise report to the user.

---

### Task 2: Database foundation (Db interface, schema, migrations)

**Files:**
- Modify: `package.json`, `package-lock.json` (SDK patch alignment, `expo-sqlite`)
- Create: `src/db/types.ts`, `src/db/testing/nodeDb.ts`, `src/db/testing/nodeDb.test.ts`, `src/db/schema.ts`, `src/db/schema.test.ts`, `src/db/open.ts`

**Interfaces:**
- Produces:
  - `export type BindValue = string | number | null`
  - `export interface Db { execAsync; runAsync; getAllAsync; getFirstAsync; withExclusiveTransactionAsync }` (exact signatures below)
  - `export function openNodeDb(): Db` (tests only)
  - `export const MIGRATIONS: readonly string[]`
  - `export async function migrate(db: Db, migrations?: readonly string[]): Promise<void>`
  - `export function getDb(): Promise<Db>`

- [ ] **Step 1: Align SDK patch versions and install expo-sqlite**

```bash
npx expo install --fix
npx expo install expo-sqlite
```

Expected: `expo`, `expo-dev-client` and `jest-expo` move to the SDK's expected patch versions, and `expo-sqlite` 58.0.x is added to `dependencies`. Then `npx expo install --check` should report no outdated packages. If `npx expo install` added `expo-sqlite` to `plugins` in `app.json`, remove it there: the plugin is not needed, and plugins live in `app.config.ts`.

Run: `rtk proxy npx jest && npm run typecheck`
Expected: all existing tests pass, typecheck clean.

- [ ] **Step 2: Write the Db interface**

Create `src/db/types.ts`:

```ts
export type BindValue = string | number | null;

/**
 * The subset of expo-sqlite that the app uses. On device it wraps expo-sqlite
 * (open.ts); in tests it wraps node:sqlite (testing/nodeDb.ts).
 */
export interface Db {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: BindValue[]): Promise<void>;
  getAllAsync<T>(sql: string, params: BindValue[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params: BindValue[]): Promise<T | null>;
  /** Queries inside the task must use txn, not the outer Db. Rolls back if the task throws. */
  withExclusiveTransactionAsync(task: (txn: Db) => Promise<void>): Promise<void>;
}
```

- [ ] **Step 3: Write the failing test-adapter test**

Create `src/db/testing/nodeDb.test.ts`:

```ts
import { openNodeDb } from './nodeDb';

test('runs statements and queries with bound values', async () => {
  const db = openNodeDb();
  await db.execAsync('CREATE TABLE t (k TEXT PRIMARY KEY, v INTEGER)');
  await db.runAsync('INSERT INTO t VALUES (?, ?)', ['a', 1]);
  await db.runAsync('INSERT INTO t VALUES (?, ?)', ['b', null]);
  expect(await db.getAllAsync('SELECT * FROM t ORDER BY k', [])).toEqual([
    { k: 'a', v: 1 },
    { k: 'b', v: null },
  ]);
  expect(await db.getFirstAsync('SELECT v FROM t WHERE k = ?', ['a'])).toEqual({ v: 1 });
  expect(await db.getFirstAsync('SELECT v FROM t WHERE k = ?', ['zzz'])).toBeNull();
});

test('an exclusive transaction commits on success and rolls back on error', async () => {
  const db = openNodeDb();
  await db.execAsync('CREATE TABLE t (k TEXT)');
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('INSERT INTO t VALUES (?)', ['kept']);
  });
  await expect(
    db.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync('INSERT INTO t VALUES (?)', ['dropped']);
      throw new Error('boom');
    }),
  ).rejects.toThrow('boom');
  expect(await db.getAllAsync('SELECT k FROM t', [])).toEqual([{ k: 'kept' }]);
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `rtk proxy npx jest src/db/testing`
Expected: FAIL: cannot find module `./nodeDb`.

- [ ] **Step 5: Implement the test adapter**

Create `src/db/testing/nodeDb.ts`:

```ts
import { DatabaseSync } from 'node:sqlite';
import type { BindValue, Db } from '../types';

/** In-memory Db for Jest. Never imported by app code (node:sqlite does not exist on device). */
export function openNodeDb(): Db {
  const raw = new DatabaseSync(':memory:');
  const db: Db = {
    async execAsync(sql) {
      raw.exec(sql);
    },
    async runAsync(sql, params) {
      raw.prepare(sql).run(...params);
    },
    async getAllAsync<T>(sql: string, params: BindValue[]) {
      return raw.prepare(sql).all(...params) as unknown as T[];
    },
    async getFirstAsync<T>(sql: string, params: BindValue[]) {
      return (raw.prepare(sql).get(...params) as unknown as T | undefined) ?? null;
    },
    async withExclusiveTransactionAsync(task) {
      raw.exec('BEGIN EXCLUSIVE');
      try {
        await task(db);
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return db;
}
```

Run: `rtk proxy npx jest src/db/testing`
Expected: PASS (2 tests).

- [ ] **Step 6: Write the failing schema tests**

Create `src/db/schema.test.ts`:

```ts
import { openNodeDb } from './testing/nodeDb';
import { MIGRATIONS, migrate } from './schema';
import type { Db } from './types';

async function version(db: Db): Promise<number> {
  return (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []))!.user_version;
}

async function columns(db: Db, table: string): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`, []);
  return rows.map((r) => r.name);
}

test('a fresh database gets every table and the latest version', async () => {
  const db = openNodeDb();
  await migrate(db);
  expect(await version(db)).toBe(MIGRATIONS.length);
  expect(await columns(db, 'cells')).toEqual(['h3', 'first_seen', 'last_seen', 'visit_count', 'mode']);
  expect(await columns(db, 'track_log')).toEqual([
    'ts',
    'accuracy',
    'speed',
    'accepted',
    'reject_reason',
    'tracking_mode',
    'battery',
    'charging',
  ]);
  expect(await columns(db, 'settings')).toEqual(['key', 'value']);
});

test('migrating twice changes nothing', async () => {
  const db = openNodeDb();
  await migrate(db);
  await db.runAsync("INSERT INTO settings VALUES ('k', 'v')", []);
  await migrate(db);
  expect(await version(db)).toBe(MIGRATIONS.length);
  expect(await db.getAllAsync('SELECT * FROM settings', [])).toEqual([{ key: 'k', value: 'v' }]);
});

test('a failing migration rolls back and keeps the earlier version', async () => {
  const db = openNodeDb();
  await expect(migrate(db, [MIGRATIONS[0]!, 'CREATE TABLE broken (; nonsense'])).rejects.toThrow();
  expect(await version(db)).toBe(1);
  expect(await columns(db, 'broken')).toEqual([]);
});

test('no table has a coordinate column', async () => {
  const db = openNodeDb();
  await migrate(db);
  const tables = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
    [],
  );
  for (const { name } of tables) {
    for (const column of await columns(db, name)) {
      expect(column).not.toMatch(/lat|lng|lon|coord|geom|point/i);
    }
  }
});
```

- [ ] **Step 7: Run them to verify they fail**

Run: `rtk proxy npx jest src/db/schema.test.ts`
Expected: FAIL: cannot find module `./schema`.

- [ ] **Step 8: Implement the schema**

Create `src/db/schema.ts`:

```ts
import type { Db } from './types';

/**
 * Ordered migrations; index i upgrades user_version i to i + 1. Never edit a
 * shipped migration; append a new one. No table may hold coordinates.
 */
export const MIGRATIONS: readonly string[] = [
  `
  -- cells keeps its rowid: the map reads newly stored cells by rowid (cellsAddedSince).
  CREATE TABLE cells (
    h3 TEXT PRIMARY KEY NOT NULL,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    visit_count INTEGER NOT NULL,
    mode TEXT NOT NULL
  );
  CREATE INDEX cells_first_seen ON cells (first_seen);
  CREATE TABLE track_log (
    ts INTEGER NOT NULL,
    accuracy REAL,
    speed REAL,
    accepted INTEGER NOT NULL,
    reject_reason TEXT,
    tracking_mode TEXT NOT NULL,
    battery REAL,
    charging INTEGER
  );
  CREATE INDEX track_log_ts ON track_log (ts);
  CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  ) WITHOUT ROWID;
  `,
];

export async function migrate(db: Db, migrations: readonly string[] = MIGRATIONS): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  for (let v = row?.user_version ?? 0; v < migrations.length; v++) {
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync(migrations[v]!);
      await txn.execAsync(`PRAGMA user_version = ${v + 1}`);
    });
  }
}
```

Run: `rtk proxy npx jest src/db`
Expected: PASS (6 tests).

- [ ] **Step 9: Implement the device connection**

Create `src/db/open.ts`:

```ts
import { type SQLiteDatabase, openDatabaseSync } from 'expo-sqlite';
import { migrate } from './schema';
import type { BindValue, Db } from './types';

const DB_NAME = 'fogmap.db';

function wrap(d: SQLiteDatabase): Db {
  return {
    execAsync: (sql) => d.execAsync(sql),
    runAsync: async (sql, params) => {
      await d.runAsync(sql, params);
    },
    getAllAsync: <T>(sql: string, params: BindValue[]) => d.getAllAsync<T>(sql, params),
    getFirstAsync: <T>(sql: string, params: BindValue[]) => d.getFirstAsync<T>(sql, params),
    withExclusiveTransactionAsync: (task) => d.withExclusiveTransactionAsync((txn) => task(wrap(txn))),
  };
}

let dbPromise: Promise<Db> | null = null;

/** The one shared connection (UI and, in Plan 3, the background task), in WAL mode and migrated. */
export function getDb(): Promise<Db> {
  dbPromise ??= (async () => {
    const db = wrap(openDatabaseSync(DB_NAME));
    await db.execAsync('PRAGMA journal_mode = WAL');
    await migrate(db);
    return db;
  })().catch((e: unknown) => {
    dbPromise = null; // let the next call retry
    throw e;
  });
  return dbPromise;
}
```

Run: `npm run typecheck && rtk proxy npx jest`
Expected: clean, all suites pass. (`open.ts` has no unit test: expo-sqlite is native. It is exercised on the device in Task 7.)

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json src/db
git commit -m "feat(db): Db interface, schema v1 with migrations, expo-sqlite connection"
```

---

### Task 3: Cell queries and the change event

**Files:**
- Create: `src/db/cells.ts`, `src/db/cells.test.ts`, `src/db/events.ts`, `src/db/events.test.ts`

**Interfaces:**
- Consumes: `Db`, `BindValue` (Task 2), `migrate` (Task 2), `RevealedCell` from `src/core/types.ts`, `openNodeDb` (tests).
- Produces:
  - `export async function upsertCells(db: Db, cells: ReadonlyMap<string, RevealedCell>): Promise<void>`. It does not open a transaction; callers wrap it in `withExclusiveTransactionAsync`.
  - `export async function cellsAddedSince(db: Db, afterRowid: number): Promise<{ ids: string[]; lastRowid: number }>`: cells first stored after `afterRowid`, in insert order; `lastRowid` is the last one returned, or `afterRowid` when none. An upsert of an existing cell keeps its rowid, so revisits are not returned again.
  - `export async function cellCount(db: Db): Promise<number>`
  - `export type CellsChange = 'added' | 'reset'`
  - `export function onCellsChanged(listener: (change: CellsChange) => void): () => void` (returns unsubscribe)
  - `export function emitCellsChanged(change: CellsChange = 'added'): void`. `'reset'` means rows were deleted, so rowids may start again from 1.

- [ ] **Step 1: Write the failing cell tests**

Create `src/db/cells.test.ts`:

```ts
import type { RevealedCell } from '../core/types';
import { cellCount, cellsAddedSince, upsertCells } from './cells';
import { migrate } from './schema';
import { openNodeDb } from './testing/nodeDb';
import type { Db } from './types';

type Row = { h3: string; first_seen: number; last_seen: number; visit_count: number; mode: string };

async function freshDb(): Promise<Db> {
  const db = openNodeDb();
  await migrate(db);
  return db;
}

async function row(db: Db, h3: string): Promise<Row | null> {
  return db.getFirstAsync<Row>('SELECT * FROM cells WHERE h3 = ?', [h3]);
}

const cell = (bucket: RevealedCell['bucket'], firstTs: number, lastTs: number): RevealedCell => ({
  bucket,
  firstTs,
  lastTs,
});

test('inserts new cells with visit_count 1', async () => {
  const db = await freshDb();
  await upsertCells(db, new Map([['a', cell('cycle', 100, 200)]]));
  expect(await row(db, 'a')).toEqual({ h3: 'a', first_seen: 100, last_seen: 200, visit_count: 1, mode: 'cycle' });
});

test('merges a later batch: earliest first_seen, latest last_seen, slowest mode', async () => {
  const db = await freshDb();
  await upsertCells(
    db,
    new Map([
      ['a', cell('walk', 100, 200)],
      ['b', cell('vehicle', 100, 200)],
    ]),
  );
  await upsertCells(
    db,
    new Map([
      ['a', cell('vehicle', 50, 150)],
      ['b', cell('cycle', 300, 400)],
    ]),
  );
  expect(await row(db, 'a')).toEqual({ h3: 'a', first_seen: 50, last_seen: 200, visit_count: 2, mode: 'walk' });
  expect(await row(db, 'b')).toEqual({ h3: 'b', first_seen: 100, last_seen: 400, visit_count: 2, mode: 'cycle' });
});

test('writes batches larger than one statement', async () => {
  const db = await freshDb();
  const many = new Map<string, RevealedCell>();
  for (let i = 0; i < 1234; i++) many.set(`c${String(i).padStart(4, '0')}`, cell('walk', i, i));
  await upsertCells(db, many);
  expect(await cellCount(db)).toBe(1234);
  expect(await row(db, 'c1233')).toEqual({ h3: 'c1233', first_seen: 1233, last_seen: 1233, visit_count: 1, mode: 'walk' });
});

test('an empty batch is a no-op', async () => {
  const db = await freshDb();
  await upsertCells(db, new Map());
  expect(await cellCount(db)).toBe(0);
});

test('cellsAddedSince returns new cells in insert order, not revisited ones', async () => {
  const db = await freshDb();
  await upsertCells(
    db,
    new Map([
      ['b', cell('walk', 1, 1)],
      ['a', cell('walk', 1, 1)],
    ]),
  );
  const first = await cellsAddedSince(db, 0);
  expect(first.ids).toEqual(['b', 'a']);
  await upsertCells(
    db,
    new Map([
      ['a', cell('walk', 2, 2)],
      ['c', cell('walk', 2, 2)],
    ]),
  );
  const second = await cellsAddedSince(db, first.lastRowid);
  expect(second.ids).toEqual(['c']);
  expect(await cellsAddedSince(db, second.lastRowid)).toEqual({ ids: [], lastRowid: second.lastRowid });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk proxy npx jest src/db/cells.test.ts`
Expected: FAIL: cannot find module `./cells`.

- [ ] **Step 3: Implement**

Create `src/db/cells.ts`:

```ts
import type { RevealedCell } from '../core/types';
import type { BindValue, Db } from './types';

// 4 bound values per row; 500 rows stays far below SQLite's variable limit.
const ROWS_PER_STATEMENT = 500;

// Same order as slowerBucket in src/core/buckets.ts: walk < cycle < vehicle.
const RANK = (col: string) => `CASE ${col} WHEN 'walk' THEN 0 WHEN 'cycle' THEN 1 ELSE 2 END`;

const UPSERT_TAIL = `
  ON CONFLICT (h3) DO UPDATE SET
    first_seen = MIN(cells.first_seen, excluded.first_seen),
    last_seen = MAX(cells.last_seen, excluded.last_seen),
    visit_count = cells.visit_count + 1,
    mode = CASE WHEN ${RANK('excluded.mode')} < ${RANK('cells.mode')} THEN excluded.mode ELSE cells.mode END`;

/**
 * Writes one batch of revealed cells. Does not open a transaction: callers wrap
 * it (with any other writes of the same batch) in withExclusiveTransactionAsync.
 */
export async function upsertCells(db: Db, cells: ReadonlyMap<string, RevealedCell>): Promise<void> {
  const entries = [...cells];
  for (let i = 0; i < entries.length; i += ROWS_PER_STATEMENT) {
    const chunk = entries.slice(i, i + ROWS_PER_STATEMENT);
    const params: BindValue[] = [];
    for (const [h3, c] of chunk) params.push(h3, c.firstTs, c.lastTs, c.bucket);
    const values = chunk.map(() => '(?, ?, ?, 1, ?)').join(', ');
    await db.runAsync(
      `INSERT INTO cells (h3, first_seen, last_seen, visit_count, mode) VALUES ${values} ${UPSERT_TAIL}`,
      params,
    );
  }
}

/**
 * Cells first stored after afterRowid, in insert order. An upsert keeps a cell's
 * rowid, so revisits are not returned again. Rowids can restart after a reset.
 */
export async function cellsAddedSince(
  db: Db,
  afterRowid: number,
): Promise<{ ids: string[]; lastRowid: number }> {
  const rows = await db.getAllAsync<{ rowid: number; h3: string }>(
    'SELECT rowid, h3 FROM cells WHERE rowid > ? ORDER BY rowid',
    [afterRowid],
  );
  const last = rows[rows.length - 1];
  return { ids: rows.map((r) => r.h3), lastRowid: last ? last.rowid : afterRowid };
}

export async function cellCount(db: Db): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM cells', []);
  return row?.n ?? 0;
}
```

Run: `rtk proxy npx jest src/db/cells.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 4: Write the failing event tests**

Create `src/db/events.test.ts`:

```ts
import { type CellsChange, emitCellsChanged, onCellsChanged } from './events';

test('listeners hear changes until they unsubscribe', () => {
  const heard: string[] = [];
  const offA = onCellsChanged(() => heard.push('a'));
  const offB = onCellsChanged(() => heard.push('b'));
  emitCellsChanged();
  offA();
  emitCellsChanged();
  offB();
  emitCellsChanged();
  expect(heard).toEqual(['a', 'b', 'b']);
});

test('a listener that unsubscribes while being called does not break the others', () => {
  const heard: string[] = [];
  const off = onCellsChanged(() => {
    heard.push('once');
    off();
  });
  const offOther = onCellsChanged(() => heard.push('other'));
  emitCellsChanged();
  emitCellsChanged();
  offOther();
  expect(heard).toEqual(['once', 'other', 'other']);
});

test('listeners get the kind of change, added by default', () => {
  const heard: CellsChange[] = [];
  const off = onCellsChanged((change) => heard.push(change));
  emitCellsChanged();
  emitCellsChanged('reset');
  off();
  expect(heard).toEqual(['added', 'reset']);
});
```

- [ ] **Step 5: Run them to verify they fail**

Run: `rtk proxy npx jest src/db/events.test.ts`
Expected: FAIL: cannot find module `./events`.

- [ ] **Step 6: Implement**

Create `src/db/events.ts`:

```ts
/** 'reset': rows were deleted, so rowids may start again from 1. */
export type CellsChange = 'added' | 'reset';

type Listener = (change: CellsChange) => void;

const listeners = new Set<Listener>();

/** In-process notice that the cells table changed (GPX import, stress fill, reset; tracking in Plan 3). */
export function onCellsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitCellsChanged(change: CellsChange = 'added'): void {
  for (const listener of [...listeners]) listener(change);
}
```

Run: `rtk proxy npx jest && npm run typecheck`
Expected: all suites pass, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/db/cells.ts src/db/cells.test.ts src/db/events.ts src/db/events.test.ts
git commit -m "feat(db): cell upsert with slowest-bucket merge, new-cell query, change event"
```

---

### Task 4: GPX end time, and the Debug data tools

**Files:**
- Modify: `src/core/gpx.ts`, `src/core/gpx.test.ts`
- Create: `src/db/devData.ts`, `src/db/devData.test.ts`

**Interfaces:**
- Consumes: `processFixes` (Plan 1), `stressCells` (Plan 1), `upsertCells`, `emitCellsChanged`, `onCellsChanged` (Task 3), `migrate`, `openNodeDb` (Task 2).
- Produces:
  - `parseGpx(xml: string, endMs: number): Fix[]`. This **changes** the second parameter from `startMs` to `endMs`. Synthetic times end at `endMs`, and real `<time>` values are kept as they are.
  - `export type ImportResult = { fixes: number; accepted: number; cells: number }`
  - `export async function importFixes(db: Db, fixes: readonly Fix[]): Promise<ImportResult>`
  - `export async function stressFill(db: Db, count: number, nowMs: number, origin: { lat: number; lng: number }): Promise<number>` (returns cells written)
  - `export async function resetAllData(db: Db): Promise<void>`

- [ ] **Step 1: Update the GPX tests to the new end-time rule**

In `src/core/gpx.test.ts`, replace the test `'synthesizes walking-pace times when any point lacks a time'` with:

```ts
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
```

Leave the other GPX tests as they are. Their second argument is now `endMs`, and they still hold.

- [ ] **Step 2: Run it to verify it fails**

Run: `rtk proxy npx jest src/core/gpx.test.ts`
Expected: FAIL: `fixes[1].ts` is about `1_000_778_000`, not `1_000_000_000`.

- [ ] **Step 3: Implement**

In `src/core/gpx.ts`, replace the doc comment and the whole `parseGpx` function (keep the constants, the regexes and `numericAttr`) with:

```ts
/**
 * Dev-only GPX reader. Uses <time> when every point has one; otherwise spaces
 * points at walking pace so the route ends at endMs (the import time) and gap
 * filling behaves like a walk.
 */
export function parseGpx(xml: string, endMs: number): Fix[] {
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
  const offsets: number[] = [];
  let elapsed = 0;
  points.forEach((p, i) => {
    const q = points[i - 1];
    if (q) elapsed += (distanceM(q.lat, q.lng, p.lat, p.lng) / WALK_MPS) * 1000;
    offsets.push(elapsed);
  });
  const startMs = endMs - elapsed;

  return points.map((p, i) => ({
    ts: hasTimes ? p.time : Math.round(startMs + offsets[i]!),
    lat: p.lat,
    lng: p.lng,
    accuracy: GPX_ACCURACY_M,
    speed: null,
  }));
}
```

Run: `rtk proxy npx jest src/core/gpx.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 4: Write the failing Debug-tools tests**

Create `src/db/devData.test.ts`:

```ts
import type { Fix } from '../core/types';
import { cellCount } from './cells';
import { importFixes, resetAllData, stressFill } from './devData';
import { onCellsChanged } from './events';
import { migrate } from './schema';
import { openNodeDb } from './testing/nodeDb';
import type { Db } from './types';

const BANGKOK = { lat: 13.7563, lng: 100.5018 };

async function freshDb(): Promise<Db> {
  const db = openNodeDb();
  await migrate(db);
  return db;
}

const fix = (over: Partial<Fix> = {}): Fix => ({
  ts: 0,
  lat: BANGKOK.lat,
  lng: BANGKOK.lng,
  accuracy: 5,
  speed: null,
  ...over,
});

async function count(db: Db, table: string): Promise<number> {
  return (await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`, []))!.n;
}

test('importFixes reveals cells like live tracking, and writes nothing else', async () => {
  const db = await freshDb();
  let changes = 0;
  const off = onCellsChanged(() => changes++);
  const result = await importFixes(db, [
    fix(),
    fix({ ts: 60_000, lng: BANGKOK.lng + 0.001 }),
    fix({ ts: 120_000, accuracy: 100 }),
  ]);
  off();
  expect(result.fixes).toBe(3);
  expect(result.accepted).toBe(2);
  expect(result.cells).toBeGreaterThanOrEqual(7);
  expect(await cellCount(db)).toBe(result.cells);
  expect(await count(db, 'track_log')).toBe(0);
  expect(await count(db, 'settings')).toBe(0);
  expect(changes).toBe(1);
});

test('importFixes with nothing accepted writes nothing and does not notify', async () => {
  const db = await freshDb();
  let changes = 0;
  const off = onCellsChanged(() => changes++);
  const result = await importFixes(db, [fix({ accuracy: 100 })]);
  off();
  expect(result).toEqual({ fixes: 1, accepted: 0, cells: 0 });
  expect(await cellCount(db)).toBe(0);
  expect(changes).toBe(0);
});

test('stressFill writes exactly count cells as walk, stamped now', async () => {
  const db = await freshDb();
  const written = await stressFill(db, 1000, 5_000, BANGKOK);
  expect(written).toBe(1000);
  expect(await cellCount(db)).toBe(1000);
  expect(
    await db.getFirstAsync('SELECT MIN(first_seen) AS lo, MAX(last_seen) AS hi, COUNT(DISTINCT mode) AS modes, MIN(mode) AS mode FROM cells', []),
  ).toEqual({ lo: 5_000, hi: 5_000, modes: 1, mode: 'walk' });
});

test('resetAllData empties every table and notifies a reset', async () => {
  const db = await freshDb();
  await stressFill(db, 50, 0, BANGKOK);
  await db.runAsync(
    "INSERT INTO track_log (ts, accepted, tracking_mode) VALUES (1, 1, 'efficient')",
    [],
  );
  await db.runAsync("INSERT INTO settings VALUES ('tracking_enabled', '1')", []);
  const heard: string[] = [];
  const off = onCellsChanged((change) => heard.push(change));
  await resetAllData(db);
  off();
  expect([await count(db, 'cells'), await count(db, 'track_log'), await count(db, 'settings')]).toEqual([0, 0, 0]);
  expect(heard).toEqual(['reset']);
});
```

- [ ] **Step 5: Run them to verify they fail**

Run: `rtk proxy npx jest src/db/devData.test.ts`
Expected: FAIL: cannot find module `./devData`.

- [ ] **Step 6: Implement**

Create `src/db/devData.ts`:

```ts
import { processFixes } from '../core/pipeline';
import { stressCells } from '../core/stress';
import type { Fix, RevealedCell } from '../core/types';
import { upsertCells } from './cells';
import { emitCellsChanged } from './events';
import type { Db } from './types';

const STRESS_SEED = 1;

export type ImportResult = { fixes: number; accepted: number; cells: number };

/**
 * Debug → GPX import. Same pipeline as live tracking, but with no previous point,
 * and it writes cells only: no track_log rows and no saved previous point, so
 * imported (possibly old) times cannot disturb live tracking or battery stats.
 */
export async function importFixes(db: Db, fixes: readonly Fix[]): Promise<ImportResult> {
  const { cells, logRows } = processFixes(fixes, null);
  if (cells.size > 0) {
    await db.withExclusiveTransactionAsync((txn) => upsertCells(txn, cells));
    emitCellsChanged();
  }
  return {
    fixes: fixes.length,
    accepted: logRows.filter((r) => r.accepted).length,
    cells: cells.size,
  };
}

/** Debug → stress fill: count road-like cells around origin, for the fog benchmark. */
export async function stressFill(
  db: Db,
  count: number,
  nowMs: number,
  origin: { lat: number; lng: number },
): Promise<number> {
  const cells = new Map<string, RevealedCell>();
  for (const h3 of stressCells(count, STRESS_SEED, origin)) {
    cells.set(h3, { bucket: 'walk', firstTs: nowMs, lastTs: nowMs });
  }
  await db.withExclusiveTransactionAsync((txn) => upsertCells(txn, cells));
  emitCellsChanged();
  return cells.size;
}

/** Debug → reset all data. */
export async function resetAllData(db: Db): Promise<void> {
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.execAsync('DELETE FROM cells; DELETE FROM track_log; DELETE FROM settings;');
  });
  emitCellsChanged('reset');
}
```

Run: `rtk proxy npx jest && npm run typecheck`
Expected: all suites pass, typecheck clean.

- [ ] **Step 7: Update the spec's GPX line**

In `docs/superpowers/specs/2026-10-28-milestone-1-design.md`, in the `gpx.ts` row of the core table, change "when timestamps are missing, synthesize them at walking pace (5 km/h)" to "when timestamps are missing, synthesize them at walking pace (5 km/h), ending at the given end time (the import time)".

- [ ] **Step 8: Commit**

```bash
git add src/core/gpx.ts src/core/gpx.test.ts src/db/devData.ts src/db/devData.test.ts docs/superpowers/specs/2026-10-28-milestone-1-design.md
git commit -m "feat(db): GPX import, stress fill and reset; synthetic GPX times end at import time"
```

---

### Task 5: Fog refresh throttle, incremental fog source, and fog timing

**Files:**
- Create: `src/map/throttle.ts`, `src/map/throttle.test.ts`, `src/map/fogSource.ts`, `src/map/fogSource.test.ts`, `src/map/fogStats.ts`, `src/map/fogStats.test.ts`

**Interfaces:**
- Consumes: `FogBuilder`, `cellsBounds`, `Bounds` (Task 1b / Task 1), `areaKm2` (Plan 1, `src/core/stats.ts`, takes `Iterable<string>`), `stressCells` (Plan 1, tests). The `readSince` function `FogSource` takes has the same shape as `cellsAddedSince(db, afterRowid)` from Task 3, minus the `db`.
- Produces:
  - `export type Throttle = { request(): void; cancel(): void }`
  - `export function createThrottle(run: () => Promise<void>, intervalMs: number, onError: (e: unknown) => void): Throttle`
  - `export type NewCells = { ids: string[]; lastRowid: number }`
  - `export type FogUpdate = { fog: Feature<MultiPolygon>; cellCount: number; areaKm2: number; bounds: Bounds | null; added: number; ms: number }`
  - `export class FogSource { constructor(readSince: (afterRowid: number) => Promise<NewCells>, pause: () => Promise<void>, now: () => number, sliceCells?: number); markReset(): void; refresh(): Promise<FogUpdate | null> }`
  - `export type FogBuild = { ms: number; added: number; cells: number; at: number }`
  - `export function recordFogBuild(build: FogBuild): void`
  - `export function recordFogError(e: unknown): void`
  - `export function fogStats(): { lastBuild: FogBuild | null; lastError: string | null }`

Throttle rules:
- A run starts at most once per `intervalMs`, and runs never overlap.
- Any number of requests during the wait, or while a run is in progress, produce exactly one more run.
- The first request runs on the next tick.
- A rejected run goes to `onError`, and later requests still work.

- [ ] **Step 1: Write the failing throttle tests**

Create `src/map/throttle.test.ts`:

```ts
import { createThrottle } from './throttle';

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

function counter(durationMs = 0) {
  const calls = { started: 0 };
  const run = () =>
    new Promise<void>((resolve) => {
      calls.started++;
      setTimeout(resolve, durationMs);
    });
  return { calls, run };
}

test('the first request runs on the next tick', async () => {
  const { calls, run } = counter();
  const t = createThrottle(run, 2000, jest.fn());
  t.request();
  expect(calls.started).toBe(0);
  await jest.advanceTimersByTimeAsync(0);
  expect(calls.started).toBe(1);
});

test('requests within the interval collapse into one trailing run', async () => {
  const { calls, run } = counter();
  const t = createThrottle(run, 2000, jest.fn());
  t.request();
  await jest.advanceTimersByTimeAsync(0);
  t.request();
  t.request();
  t.request();
  await jest.advanceTimersByTimeAsync(1999);
  expect(calls.started).toBe(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(calls.started).toBe(2);
  await jest.advanceTimersByTimeAsync(10_000);
  expect(calls.started).toBe(2);
});

test('a request during a run waits for it to finish, then runs once more', async () => {
  const { calls, run } = counter(5000);
  const t = createThrottle(run, 2000, jest.fn());
  t.request();
  await jest.advanceTimersByTimeAsync(0);
  t.request();
  t.request();
  await jest.advanceTimersByTimeAsync(4999);
  expect(calls.started).toBe(1);
  await jest.advanceTimersByTimeAsync(1);
  await jest.advanceTimersByTimeAsync(0); // the follow-up is scheduled after the run settles
  expect(calls.started).toBe(2);
});

test('cancel drops a scheduled run', async () => {
  const { calls, run } = counter();
  const t = createThrottle(run, 2000, jest.fn());
  t.request();
  t.cancel();
  await jest.advanceTimersByTimeAsync(5000);
  expect(calls.started).toBe(0);
});

test('a failed run is reported and later requests still run', async () => {
  const onError = jest.fn();
  let n = 0;
  const t = createThrottle(
    async () => {
      n++;
      if (n === 1) throw new Error('boom');
    },
    2000,
    onError,
  );
  t.request();
  await jest.advanceTimersByTimeAsync(0);
  expect(onError).toHaveBeenCalledWith(new Error('boom'));
  t.request();
  await jest.advanceTimersByTimeAsync(2000);
  expect(n).toBe(2);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk proxy npx jest src/map/throttle.test.ts`
Expected: FAIL: cannot find module `./throttle`.

- [ ] **Step 3: Implement**

Create `src/map/throttle.ts`:

```ts
export type Throttle = { request(): void; cancel(): void };

/**
 * Runs `run` at most once per intervalMs and never twice at the same time. Any
 * number of requests while waiting or running lead to exactly one more run.
 */
export function createThrottle(
  run: () => Promise<void>,
  intervalMs: number,
  onError: (e: unknown) => void,
): Throttle {
  let lastStart = -Infinity;
  let running = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const start = () => {
    timer = null;
    pending = false;
    running = true;
    lastStart = Date.now();
    run()
      .catch(onError)
      .finally(() => {
        running = false;
        if (pending) schedule();
      });
  };

  const schedule = () => {
    if (timer !== null) return;
    timer = setTimeout(start, Math.max(0, lastStart + intervalMs - Date.now()));
  };

  return {
    request() {
      if (running) pending = true;
      else schedule();
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = false;
    },
  };
}
```

Run: `rtk proxy npx jest src/map/throttle.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 4: Write the failing fog source tests**

`FogSource` keeps one `FogBuilder` for the app's lifetime. Each refresh reads only cells stored after the last rowid it saw, adds them in slices of `sliceCells` (default 2,000) with an awaited `pause()` between slices, so the UI can respond during the first, large load, then calls `toFeature()` once. It also keeps the revealed area and bounds up to date from the new cells only, because `areaKm2` and `cellsBounds` call h3 once per cell and are too slow to repeat over every cell. Rules:
- Nothing new (and no pending reset) → `refresh()` resolves `null`.
- `markReset()` → the next refresh clears the builder, area and bounds, and reads from rowid 0. This is needed because SQLite reuses rowids from 1 once the table is emptied.
- If a refresh fails at any point (read, pause or build), the next refresh starts from scratch, because the builder may hold a partial slice.
- `ms` is JS time spent reading results into the builder and building, not counting the pauses.

Create `src/map/fogSource.test.ts`:

```ts
import type { Feature, MultiPolygon, Position } from 'geojson';
import { buildFog, cellsBounds } from '../core/fog';
import { areaKm2 } from '../core/stats';
import { stressCells } from '../core/stress';
import { FogSource, type NewCells } from './fogSource';

const BANGKOK = { lat: 13.7563, lng: 100.5018 };
const CELLS = stressCells(300, 1, BANGKOK);

/** Order-independent key of a closed ring: its vertices, rounded and sorted. */
const ringKey = (ring: Position[]) =>
  ring
    .slice(0, -1)
    .map(([lng, lat]) => `${lng!.toFixed(7)},${lat!.toFixed(7)}`)
    .sort()
    .join(';');

/** Order-independent shape of a fog feature, for comparing builds. */
const shape = (f: Feature<MultiPolygon>) =>
  f.geometry.coordinates.map((polygon) => polygon.map(ringKey).join('|')).sort();

/** A fake cells table: row i has rowid i + 1, and rowids restart from 1 after clear(), like SQLite. */
function table(initial: string[] = []) {
  let rows = [...initial];
  return {
    insert(ids: string[]) {
      rows.push(...ids);
    },
    clear() {
      rows = [];
    },
    readSince: async (after: number): Promise<NewCells> => {
      const ids = rows.slice(after);
      return { ids, lastRowid: after + ids.length };
    },
  };
}

const noPause = async () => {};
const now = () => 0;

test('the first refresh adds every stored cell', async () => {
  const source = new FogSource(table(CELLS).readSince, noPause, now);
  const update = (await source.refresh())!;
  expect(update.cellCount).toBe(300);
  expect(update.added).toBe(300);
  expect(update.areaKm2).toBeCloseTo(areaKm2(CELLS), 9);
  expect(update.bounds).toEqual(cellsBounds(CELLS));
  expect(shape(update.fog)).toEqual(shape(buildFog(CELLS)));
});

test('a refresh with nothing new returns null', async () => {
  const source = new FogSource(table(CELLS).readSince, noPause, now);
  await source.refresh();
  expect(await source.refresh()).toBeNull();
});

test('later refreshes add only new cells and match a full build', async () => {
  const t = table(CELLS.slice(0, 200));
  const source = new FogSource(t.readSince, noPause, now);
  await source.refresh();
  t.insert(CELLS.slice(200));
  const update = (await source.refresh())!;
  expect(update.added).toBe(100);
  expect(update.cellCount).toBe(300);
  expect(update.areaKm2).toBeCloseTo(areaKm2(CELLS), 9);
  expect(update.bounds).toEqual(cellsBounds(CELLS));
  expect(shape(update.fog)).toEqual(shape(buildFog(CELLS)));
});

test('pauses between slices, not before the first one', async () => {
  let pauses = 0;
  const source = new FogSource(
    table(CELLS).readSince,
    async () => {
      pauses++;
    },
    now,
    100,
  );
  await source.refresh();
  expect(pauses).toBe(2);
});

test('ms counts work between pauses, not the pauses', async () => {
  let clock = 0;
  const source = new FogSource(
    table(CELLS).readSince,
    async () => {
      clock += 1_000;
    },
    () => clock,
    100,
  );
  expect((await source.refresh())!.ms).toBe(0);
});

test('after markReset the next refresh starts from scratch, though rowids restarted', async () => {
  const t = table(CELLS);
  const source = new FogSource(t.readSince, noPause, now);
  await source.refresh();
  t.clear();
  t.insert(CELLS.slice(0, 50));
  source.markReset();
  const update = (await source.refresh())!;
  expect(update.cellCount).toBe(50);
  expect(update.added).toBe(50);
  expect(update.areaKm2).toBeCloseTo(areaKm2(CELLS.slice(0, 50)), 9);
  expect(update.bounds).toEqual(cellsBounds(CELLS.slice(0, 50)));
  expect(shape(update.fog)).toEqual(shape(buildFog(CELLS.slice(0, 50))));
});

test('a reset to an empty table gives the all-fog world', async () => {
  const t = table(CELLS);
  const source = new FogSource(t.readSince, noPause, now);
  await source.refresh();
  t.clear();
  source.markReset();
  const update = (await source.refresh())!;
  expect(update).toMatchObject({ cellCount: 0, added: 0, areaKm2: 0, bounds: null });
  expect(update.fog.geometry).toEqual(buildFog([]).geometry);
});

test('after a failed refresh the next one starts from scratch', async () => {
  const t = table(CELLS);
  const asked: number[] = [];
  let fail = true;
  const source = new FogSource(
    async (after) => {
      asked.push(after);
      return t.readSince(after);
    },
    async () => {
      if (fail) throw new Error('interrupted');
    },
    now,
    100,
  );
  await expect(source.refresh()).rejects.toThrow('interrupted');
  fail = false;
  const update = (await source.refresh())!;
  expect(asked).toEqual([0, 0]);
  expect(update.cellCount).toBe(300);
  expect(update.added).toBe(300);
  expect(update.areaKm2).toBeCloseTo(areaKm2(CELLS), 9);
});
```

Run: `rtk proxy npx jest src/map/fogSource.test.ts`
Expected: FAIL: cannot find module `./fogSource`.

Create `src/map/fogSource.ts`:

```ts
import type { Feature, MultiPolygon } from 'geojson';
import { type Bounds, FogBuilder, cellsBounds } from '../core/fog';
import { areaKm2 } from '../core/stats';

/** Cells stored after a rowid, as returned by cellsAddedSince. */
export type NewCells = { ids: string[]; lastRowid: number };

export type FogUpdate = {
  fog: Feature<MultiPolygon>;
  cellCount: number;
  areaKm2: number;
  bounds: Bounds | null;
  /** Cells added by this refresh. */
  added: number;
  /** JS time spent, not counting the pauses between slices. */
  ms: number;
};

// ~0.14 ms per cell on an iPhone 14 (Release), so one slice blocks for ~0.3 s.
const SLICE_CELLS = 2_000;

function unionBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (a === null) return b;
  if (b === null) return a;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/**
 * Keeps one FogBuilder for the app's lifetime and feeds it only the cells stored
 * since the last refresh, in slices with a pause between them. An update costs
 * the new cells plus one toFeature, never a full rebuild (a full rebuild of
 * 50,000 cells takes ~7 s on an iPhone 14).
 */
export class FogSource {
  private readonly builder = new FogBuilder();
  private lastRowid = 0;
  private needsReset = false;
  private area = 0;
  private bounds: Bounds | null = null;

  constructor(
    private readonly readSince: (afterRowid: number) => Promise<NewCells>,
    private readonly pause: () => Promise<void>,
    private readonly now: () => number,
    private readonly sliceCells = SLICE_CELLS,
  ) {}

  /** Stored cells were deleted: the next refresh starts again from rowid 0. */
  markReset(): void {
    this.needsReset = true;
  }

  /** The fog after adding newly stored cells, or null when nothing changed. */
  async refresh(): Promise<FogUpdate | null> {
    const reset = this.needsReset;
    this.needsReset = false;
    try {
      const { ids, lastRowid } = await this.readSince(reset ? 0 : this.lastRowid);
      if (!reset && ids.length === 0) return null;
      let ms = 0;
      let start = this.now();
      if (reset) {
        this.builder.reset();
        this.area = 0;
        this.bounds = null;
      }
      for (let i = 0; i < ids.length; i += this.sliceCells) {
        if (i > 0) {
          ms += this.now() - start;
          await this.pause();
          start = this.now();
        }
        const slice = ids.slice(i, i + this.sliceCells);
        this.builder.add(slice);
        this.area += areaKm2(slice);
        this.bounds = unionBounds(this.bounds, cellsBounds(slice));
      }
      const fog = this.builder.toFeature();
      ms += this.now() - start;
      this.lastRowid = lastRowid;
      return { fog, cellCount: this.builder.size, areaKm2: this.area, bounds: this.bounds, added: ids.length, ms };
    } catch (e) {
      // The builder may hold part of a slice: rebuild everything next time.
      this.needsReset = true;
      throw e;
    }
  }
}
```

Run: `rtk proxy npx jest src/map/fogSource.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 4b: Write the failing fog-stats test**

Create `src/map/fogStats.test.ts`:

```ts
import { fogStats, recordFogBuild, recordFogError } from './fogStats';

test('keeps the last build and the last error until the next success', () => {
  expect(fogStats()).toEqual({ lastBuild: null, lastError: null });
  recordFogBuild({ ms: 12, added: 100, cells: 100, at: 1 });
  recordFogError(new Error('db closed'));
  expect(fogStats()).toEqual({ lastBuild: { ms: 12, added: 100, cells: 100, at: 1 }, lastError: 'db closed' });
  recordFogBuild({ ms: 15, added: 20, cells: 120, at: 2 });
  expect(fogStats()).toEqual({ lastBuild: { ms: 15, added: 20, cells: 120, at: 2 }, lastError: null });
  recordFogError('plain string');
  expect(fogStats().lastError).toBe('plain string');
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `rtk proxy npx jest src/map/fogStats.test.ts`
Expected: FAIL: cannot find module `./fogStats`.

- [ ] **Step 6: Implement**

Create `src/map/fogStats.ts`:

```ts
/** One fog refresh: JS time spent, cells added by it, total cells afterwards. */
export type FogBuild = { ms: number; added: number; cells: number; at: number };

let lastBuild: FogBuild | null = null;
let lastError: string | null = null;

/** Shown on the Debug tab: how long the last fog refresh took. */
export function recordFogBuild(build: FogBuild): void {
  lastBuild = build;
  lastError = null;
}

export function recordFogError(e: unknown): void {
  lastError = e instanceof Error ? e.message : String(e);
}

export function fogStats(): { lastBuild: FogBuild | null; lastError: string | null } {
  return { lastBuild, lastError };
}
```

Run: `rtk proxy npx jest && npm run typecheck`
Expected: all suites pass, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/map
git commit -m "feat(map): fog refresh throttle, incremental fog source, fog timing"
```

---

### Task 6: App shell with expo-router and the fog map

**Files:**
- Modify: `package.json`, `package-lock.json`, `app.json` (only if `expo install` added plugins), `app.config.ts`, `index.ts`
- Delete: `App.tsx`
- Create: `src/config.ts`, `src/map/fogStyle.ts`, `src/map/useFog.ts`, `src/screens/MapScreen.tsx`, `src/app/_layout.tsx`, `src/app/index.tsx`

**Interfaces:**
- Consumes: `buildFog`, `Bounds` (Task 1), `getDb` (Task 2), `cellsAddedSince`, `onCellsChanged` (Task 3), `createThrottle`, `FogSource`, `recordFogBuild`, `recordFogError` (Task 5).
- Produces:
  - `src/config.ts` exports `DEBUG_SCREEN: boolean`, `MAP_STYLE_URL`, `BANGKOK: { lat: number; lng: number }`, `DEFAULT_ZOOM`, `FOG_REFRESH_MS`, `STRESS_FILL_CELLS`
  - `useFog(): FogState` with `FogState = { fog: Feature<MultiPolygon>; cellCount: number; areaKm2: number; bounds: Bounds | null }`
  - `MapScreen` component; a tabs layout that Task 7 adds the Debug tab to.

- [ ] **Step 1: Install the router and the map**

```bash
npx expo install expo-router react-native-safe-area-context react-native-screens expo-linking expo-constants
npm install @maplibre/maplibre-react-native@^11.5.0
```

`@maplibre/maplibre-react-native` is not Expo-maintained, so it is installed with npm at the checked major version. Its peer range is `expo >= 54`. After installing, check that `npx expo install --check` reports nothing outdated. If `npx expo install` added entries to `plugins` in `app.json`, delete the `plugins` key from `app.json`: Step 2 lists every plugin in `app.config.ts`.

- [ ] **Step 2: Configure the app**

Replace `app.config.ts` with:

```ts
import type { ConfigContext, ExpoConfig } from 'expo/config';

// Extends app.json. APPLE_TEAM_ID comes from .env.local; when it is unset,
// `expo run:ios` asks for a team on first build. All config plugins live here.
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'fogmap',
  slug: 'fogmap',
  scheme: 'fogmap',
  plugins: ['expo-router', '@maplibre/maplibre-react-native'],
  ios: {
    ...config.ios,
    bundleIdentifier: 'com.supaohm.fogmap',
    appleTeamId: process.env.APPLE_TEAM_ID,
    supportsTablet: false,
  },
  android: {
    ...config.android,
    package: 'com.supaohm.fogmap',
  },
});
```

Replace `index.ts` with:

```ts
// Entry point. Background task definitions (Plan 3) must be imported above this
// line, so they exist when iOS relaunches the app in the background without UI.
import 'expo-router/entry';
```

Delete `App.tsx` (its h3 self-check and benchmark move to the Debug tab in Task 7).

Create `src/config.ts`:

```ts
/** Debug tab: on unless the build sets EXPO_PUBLIC_DEBUG_SCREEN=0 (inlined at bundle time). */
export const DEBUG_SCREEN = process.env.EXPO_PUBLIC_DEBUG_SCREEN !== '0';

/** OpenFreeMap vector style (free, no key). MapTiler is the fallback if it fails. */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

export const BANGKOK = { lat: 13.7563, lng: 100.5018 };
export const DEFAULT_ZOOM = 12;

/** Fog is rebuilt at most this often. */
export const FOG_REFRESH_MS = 2000;

export const STRESS_FILL_CELLS = 50_000;
```

- [ ] **Step 3: Fog style and the fog hook**

Create `src/map/fogStyle.ts`:

```ts
import type { FillLayerSpecification, LineLayerSpecification } from '@maplibre/maplibre-react-native';

const FOG_COLOR = '#10131c';

export const FOG_FILL_PAINT: FillLayerSpecification['paint'] = {
  'fill-color': FOG_COLOR,
  'fill-opacity': 0.8,
};

/** A blurred line along every fog edge, for a soft boundary. Drop it if it looks wrong on device. */
export const FOG_EDGE_PAINT: LineLayerSpecification['paint'] = {
  'line-color': FOG_COLOR,
  'line-opacity': 0.5,
  'line-width': 14,
  'line-blur': 12,
};
```

Create `src/map/useFog.ts`:

```ts
import type { Feature, MultiPolygon } from 'geojson';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { FOG_REFRESH_MS } from '../config';
import { type Bounds, buildFog } from '../core/fog';
import { cellsAddedSince } from '../db/cells';
import { onCellsChanged } from '../db/events';
import { getDb } from '../db/open';
import { FogSource } from './fogSource';
import { recordFogBuild, recordFogError } from './fogStats';
import { createThrottle } from './throttle';

export type FogState = {
  fog: Feature<MultiPolygon>;
  cellCount: number;
  areaKm2: number;
  bounds: Bounds | null;
};

const EMPTY: FogState = { fog: buildFog([]), cellCount: 0, areaKm2: 0, bounds: null };

// Lets touches and renders through between slices of the first load.
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Fog for the map. Adds newly stored cells when cells change or the app returns
 * to the foreground, at most once every FOG_REFRESH_MS, never in the background.
 */
export function useFog(): FogState {
  const [state, setState] = useState<FogState>(EMPTY);

  useEffect(() => {
    let mounted = true;
    const source = new FogSource(
      async (afterRowid) => cellsAddedSince(await getDb(), afterRowid),
      pause,
      () => performance.now(),
    );
    const throttle = createThrottle(
      async () => {
        const update = await source.refresh();
        if (update === null) return;
        recordFogBuild({ ms: update.ms, added: update.added, cells: update.cellCount, at: Date.now() });
        if (mounted) {
          setState({ fog: update.fog, cellCount: update.cellCount, areaKm2: update.areaKm2, bounds: update.bounds });
        }
      },
      FOG_REFRESH_MS,
      recordFogError,
    );

    throttle.request();
    const offCells = onCellsChanged((change) => {
      if (change === 'reset') source.markReset();
      if (AppState.currentState === 'active') throttle.request();
    });
    const appState = AppState.addEventListener('change', (s) => {
      if (s === 'active') throttle.request();
    });
    return () => {
      mounted = false;
      throttle.cancel();
      offCells();
      appState.remove();
    };
  }, []);

  return state;
}
```

- [ ] **Step 4: Map screen and routes**

Create `src/screens/MapScreen.tsx`:

```tsx
import { Camera, type CameraRef, GeoJSONSource, Layer, Map as MapView } from '@maplibre/maplibre-react-native';
import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BANGKOK, DEFAULT_ZOOM, MAP_STYLE_URL } from '../config';
import { FOG_EDGE_PAINT, FOG_FILL_PAINT } from '../map/fogStyle';
import { useFog } from '../map/useFog';

const FIT_PADDING = { top: 120, right: 60, bottom: 60, left: 60 };

export function MapScreen() {
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraRef>(null);
  const { fog, cellCount, areaKm2, bounds } = useFog();

  const fitRevealed = () => {
    if (bounds) camera.current?.fitBounds(bounds, { padding: FIT_PADDING, duration: 800 });
  };

  return (
    <View style={styles.root}>
      <MapView style={styles.root} mapStyle={MAP_STYLE_URL}>
        <Camera
          ref={camera}
          initialViewState={{ center: [BANGKOK.lng, BANGKOK.lat], zoom: DEFAULT_ZOOM }}
        />
        <GeoJSONSource id="fog" data={fog}>
          <Layer id="fog-fill" type="fill" paint={FOG_FILL_PAINT} />
          <Layer id="fog-edge" type="line" paint={FOG_EDGE_PAINT} />
        </GeoJSONSource>
      </MapView>
      <View style={[styles.overlay, { top: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.chip}>
          <Text style={styles.chipText}>
            {areaKm2.toFixed(2)} km² · {cellCount.toLocaleString()} cells
          </Text>
        </View>
        {bounds && (
          <Pressable style={styles.chip} onPress={fitRevealed} accessibilityRole="button">
            <Text style={styles.chipText}>Fit revealed</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between' },
  chip: { backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: 14, fontWeight: '600', color: '#10131c' },
});
```

Create `src/app/_layout.tsx`:

```tsx
import { Tabs } from 'expo-router/js-tabs';

export default function Layout() {
  return (
    <Tabs>
      <Tabs.Screen name="index" options={{ title: 'Map', headerShown: false }} />
    </Tabs>
  );
}
```

Create `src/app/index.tsx`:

```tsx
export { MapScreen as default } from '../screens/MapScreen';
```

- [ ] **Step 5: Typecheck and tests**

Run: `npm run typecheck && rtk proxy npx jest`
Expected: clean, all suites pass.

If the typecheck rejects a MapLibre prop, read the type in `node_modules/@maplibre/maplibre-react-native/lib/typescript/module/src/components/...` and fix the call to match it. Do not switch to v10 names (`MapView`, `ShapeSource`, `FillLayer`, `style=`), because they do not exist in v11.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json app.json app.config.ts index.ts src/config.ts src/map/fogStyle.ts src/map/useFog.ts src/screens/MapScreen.tsx src/app
git rm App.tsx
git commit -m "feat(map): expo-router tabs and MapLibre map with fog"
```

- [ ] **Step 7: Device check (controller and user, not the implementer)**

1. Stop the running Metro server, then rebuild the native app (new native modules): `npx expo run:ios --device 00008110-000A41CA3A39401E`. This starts Metro again.
2. The user confirms:
   - the Map tab shows OpenFreeMap streets around Bangkok under an even dark fog;
   - the chip reads `0.00 km² · 0 cells`;
   - the map pans and zooms.
   If the style fails to load, report it: the MapTiler fallback needs a key, so it is the user's decision.

---

### Task 7: Debug tab

**Files:**
- Modify: `package.json`, `package-lock.json`, `src/app/_layout.tsx`
- Create: `src/screens/DebugScreen.tsx`, `src/app/debug.tsx`

**Interfaces:**
- Consumes: `DEBUG_SCREEN`, `BANGKOK`, `STRESS_FILL_CELLS` (Task 6), `runFogBenchmark`, `FogBenchmarkRow` (Task 1), `parseGpx` (Task 4), `runH3SelfCheck` (Plan 1), `cellCount` (Task 3), `importFixes`, `stressFill`, `resetAllData` (Task 4), `onCellsChanged` (Task 3), `getDb` (Task 2), `fogStats` (Task 5).
- Produces: the `DebugScreen` component (Plan 3 adds the tracking and battery sections to it).

- [ ] **Step 1: Install the file pickers**

```bash
npx expo install expo-document-picker expo-file-system
```

As in Task 6, if `app.json` gained `plugins`, delete them. No plugin is needed: picking a file through the Files app needs no iCloud entitlement, and a free Apple ID cannot get that entitlement anyway.

- [ ] **Step 2: Write the Debug screen**

Create `src/screens/DebugScreen.tsx`:

```tsx
import { getDocumentAsync } from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useFocusEffect } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Alert, Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BANGKOK, STRESS_FILL_CELLS } from '../config';
import { type FogBenchmarkRow, runFogBenchmark } from '../core/fogBenchmark';
import { parseGpx } from '../core/gpx';
import { runH3SelfCheck } from '../core/h3SelfCheck';
import { cellCount } from '../db/cells';
import { importFixes, resetAllData, stressFill } from '../db/devData';
import { onCellsChanged } from '../db/events';
import { getDb } from '../db/open';
import { fogStats } from '../map/fogStats';

const BENCHMARK_SIZES = [10_000, 25_000, 50_000];

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function DebugScreen() {
  const [cells, setCells] = useState<number | null>(null);
  const [fog, setFog] = useState(fogStats);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [bench, setBench] = useState<FogBenchmarkRow[] | null>(null);
  const [selfCheck] = useState(runH3SelfCheck);

  const refresh = useCallback(() => {
    setFog(fogStats());
    getDb()
      .then(cellCount)
      .then(setCells, (e: unknown) => setStatus(`Error: ${message(e)}`));
  }, []);
  useFocusEffect(refresh);
  useEffect(() => onCellsChanged(refresh), [refresh]);

  const run = async (label: string, action: () => Promise<string>) => {
    setBusy(true);
    setStatus(`${label}…`);
    try {
      setStatus(await action());
    } catch (e) {
      setStatus(`${label} failed: ${message(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const importGpx = () =>
    run('Importing GPX', async () => {
      const picked = await getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      const asset = picked.canceled ? undefined : picked.assets[0];
      if (!asset) return 'Import cancelled';
      const fixes = parseGpx(await new File(asset.uri).text(), Date.now());
      const r = await importFixes(await getDb(), fixes);
      return `${asset.name}: ${r.accepted}/${r.fixes} fixes accepted, ${r.cells.toLocaleString()} cells`;
    });

  const fill = () =>
    run('Stress fill', async () => {
      const n = await stressFill(await getDb(), STRESS_FILL_CELLS, Date.now(), BANGKOK);
      return `Stress fill wrote ${n.toLocaleString()} cells`;
    });

  const benchmark = () =>
    run('Fog benchmark', async () => {
      // Let the status render before buildFog blocks the JS thread.
      await new Promise((resolve) => setTimeout(resolve, 50));
      setBench(runFogBenchmark(BENCHMARK_SIZES, BANGKOK, () => performance.now()));
      return 'Fog benchmark done';
    });

  const confirmReset = () =>
    Alert.alert('Reset all data?', 'Deletes every revealed cell, log row and setting.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: () =>
          void run('Reset', async () => {
            await resetAllData(await getDb());
            return 'All data deleted';
          }),
      },
    ]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Section title="Data">
        <Text>Cells stored: {cells === null ? '…' : cells.toLocaleString()}</Text>
        <Text>Build: {__DEV__ ? 'Debug' : 'Release'}</Text>
      </Section>

      <Section title="Fog">
        <Text>
          Last refresh:{' '}
          {fog.lastBuild
            ? `${Math.round(fog.lastBuild.ms)} ms, +${fog.lastBuild.added.toLocaleString()} → ${fog.lastBuild.cells.toLocaleString()} cells`
            : 'none yet (open the Map tab)'}
        </Text>
        {fog.lastError && <Text style={styles.fail}>Last error: {fog.lastError}</Text>}
        <Button title="Benchmark 10k / 25k / 50k" onPress={benchmark} disabled={busy} />
        {bench?.map((r) => (
          <Text key={r.cells}>
            {r.cells.toLocaleString()} cells: {Math.round(r.ms)} ms, {r.polygons} polygons,{' '}
            {r.vertices.toLocaleString()} vertices
          </Text>
        ))}
      </Section>

      <Section title="Test data">
        <Button title="Import GPX…" onPress={importGpx} disabled={busy} />
        <Button
          title={`Stress fill ${STRESS_FILL_CELLS.toLocaleString()} cells`}
          onPress={fill}
          disabled={busy}
        />
        <Button title="Reset all data" color="#cf222e" onPress={confirmReset} disabled={busy} />
        {status !== '' && <Text>{status}</Text>}
      </Section>

      <Section title="h3-js self-check">
        {selfCheck.map((r) => (
          <Text key={r.name} style={r.ok ? styles.ok : styles.fail}>
            {r.ok ? 'PASS' : 'FAIL'} {r.name}: {r.detail}
          </Text>
        ))}
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.title}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 20 },
  section: { gap: 6 },
  title: { fontSize: 17, fontWeight: '600' },
  ok: { color: '#1a7f37' },
  fail: { color: '#cf222e', fontWeight: '600' },
});
```

Create `src/app/debug.tsx`:

```tsx
export { DebugScreen as default } from '../screens/DebugScreen';
```

Replace `src/app/_layout.tsx` with:

```tsx
import { Tabs } from 'expo-router/js-tabs';
import { DEBUG_SCREEN } from '../config';

export default function Layout() {
  return (
    <Tabs>
      <Tabs.Screen name="index" options={{ title: 'Map', headerShown: false }} />
      {/* href: null hides the tab when the build turns the Debug screen off. */}
      <Tabs.Screen name="debug" options={{ title: 'Debug', href: DEBUG_SCREEN ? undefined : null }} />
    </Tabs>
  );
}
```


- [ ] **Step 3: Typecheck and tests**

Run: `npm run typecheck && rtk proxy npx jest`
Expected: clean, all suites pass.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/screens/DebugScreen.tsx src/app
git commit -m "feat(debug): Debug tab with GPX import, stress fill, fog benchmark and reset"
```

- [ ] **Step 5: Device check (controller and user, not the implementer)**

1. Rebuild, because of the new native modules: stop Metro, then run `npx expo run:ios --device 00008110-000A41CA3A39401E`.
2. The user checks the Debug tab:
   - the h3 self-check shows PASS;
   - "Stress fill 50,000 cells" reports 50,000;
   - the Map tab then shows a revealed corridor near Bangkok, and "Fit revealed" frames it;
   - the Debug tab's "Last refresh" shows a time and "+50,000 → 50,000 cells";
   - "Reset all data" asks for confirmation, then the map is fully fogged again.

---

### Task 8: Test route and Release acceptance on device

**Files:**
- Create: `scripts/make-test-gpx.mjs`
- Modify: `docs/superpowers/specs/2026-10-28-milestone-1-design.md` (record results)

**Interfaces:**
- Produces: `node scripts/make-test-gpx.mjs <out.gpx> [km=50] [seed=7]` writes a GPX track with no `<time>` elements and points 20–200 m apart. With synthetic walking-pace times, every gap is filled.

- [ ] **Step 1: Write the generator**

Create `scripts/make-test-gpx.mjs`:

```js
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
```

Run: `node scripts/make-test-gpx.mjs /tmp/fogmap-test-50km.gpx` (the controller uses the session scratchpad instead of `/tmp`)
Expected: prints about 450 points and `50.0 km`.

- [ ] **Step 2: Check it against the real pipeline**

Create a throwaway test at `src/gpx-check.test.ts` (it is not committed):

```ts
import { readFileSync } from 'node:fs';
import { parseGpx } from './core/gpx';
import { processFixes } from './core/pipeline';

test('the generated route is fully accepted', () => {
  const fixes = parseGpx(readFileSync(process.env.GPX!, 'utf8'), Date.now());
  const { cells, logRows } = processFixes(fixes, null);
  console.log(`${fixes.length} fixes, ${cells.size} cells`);
  expect(logRows.every((r) => r.accepted)).toBe(true);
});
```

Run: `GPX=/tmp/fogmap-test-50km.gpx rtk proxy npx jest src/gpx-check.test.ts`, then `rm src/gpx-check.test.ts`.
Expected: PASS; roughly 450 fixes and a few thousand cells.

- [ ] **Step 3: Commit**

```bash
git add scripts/make-test-gpx.mjs
git commit -m "chore: script to generate a synthetic GPX test route"
```

- [ ] **Step 4: Release acceptance (controller and user)**

1. Build Release: `npx expo run:ios --device 00008110-000A41CA3A39401E --configuration Release`.
2. Send the generated `.gpx` to the iPhone (AirDrop, then "Save to Files").
3. On the phone:
   - **GPX corridor:** Debug → Reset all data, then Import GPX…, then Map → Fit revealed. Zoom along the route: the corridor must have **no visible gaps**. Note the cell count and the "Last refresh" time.
   - **Fog shape:** the fog should be dark everywhere except the corridor. If the whole map is clear, or the revealed area is dark and the rest clear, the ring winding is wrong. Report it, and fix `buildFog` to reverse the rings before going on.
   - **Soft edge:** decide with the user whether the blurred edge looks right; if not, remove the `fog-edge` layer.
   - **50,000 cells:** Debug → Stress fill 50,000, then go to Map. Pan and zoom for 30 s. It must stay smooth (no visible stutter while panning), including while the first load runs. Note the "Last refresh" time (first load of 50,000).
   - **Small update at 50,000:** with the 50,000 cells still stored, Debug → Import GPX… again, then go to Map. Note the "Last refresh" time: it adds only the corridor's cells, but `toFeature` still walks every outline, so this is the per-update cost at 50k. Also note whether the tab buttons stutter for a moment.
   - **Resolution 10 look:** take a screenshot zoomed into a street-level part of the corridor, for the open question on resolution.
4. Record the results in the spec, in a new subsection `### Plan 2 device results (YYYY-MM-DD, Release)` under "Fog performance": GPX cells and refresh ms, corridor gaps yes/no, 50k first-load ms, small-update ms at 50k, panning smooth yes/no, soft edge kept or removed, and the user's first impression of resolution 10.
5. Commit with `docs(spec): record Plan 2 device results`.

---

### Task 9: Wider reveal, coarse fog when zoomed out, ground-width soft edge (added after the Task 8 device check)

**Why:** On device the user found the revealed area too narrow ("road wide"), and zoomed out it read as lines instead of places visited; the fixed 14 px soft edge also painted narrow corridors darker than the fog. User decision ("both"):
1. `REVEAL_RADIUS` 1 → 2 (corridor ~650 m instead of ~400 m).
2. Below zoom 12, draw the fog from the res-8 parents of the stored cells (~1 km hexagons). From zoom 12, draw the stored res-10 cells as now. Storage stays res-10 cells only.
3. The soft edge keeps a constant width on the ground (exponential zoom interpolation), so it is invisible when zoomed out and ~14 px at street level.

**Files:**
- Modify: `src/core/constants.ts`, `src/core/reveal.test.ts`, `src/core/pipeline.test.ts`, `src/core/fog.ts`, `src/core/fog.test.ts`, `src/config.ts`, `src/map/fogSource.ts`, `src/map/fogSource.test.ts`, `src/map/fogStyle.ts`, `src/map/useFog.ts`, `src/screens/MapScreen.tsx`

**Interfaces:**
- Consumes: `FogBuilder`, `buildFog` (`src/core/fog.ts`), `FogSource`, `FogUpdate` (`src/map/fogSource.ts`), `useFog`, `FogState` (`src/map/useFog.ts`), `Layer` from MapLibre 11 (its props include style-spec `minzoom` / `maxzoom`: a layer shows at `minzoom <= zoom < maxzoom`).
- Produces:
  - `REVEAL_RADIUS = 2`
  - `export function parentCells(cells: Iterable<string>, res: number): string[]` in `src/core/fog.ts` (unique parents, first-seen order)
  - `src/config.ts`: `COARSE_FOG_RES = 8`, `FINE_FOG_MIN_ZOOM = 12`
  - `FogUpdate` gains `coarseFog: Feature<MultiPolygon>`; `FogState` gains `coarseFog`
  - `src/map/fogStyle.ts`: `FOG_FILL_PAINT` (unchanged), `FINE_EDGE_PAINT`, `COARSE_EDGE_PAINT` (replace `FOG_EDGE_PAINT`)

- [ ] **Step 1: Wider reveal (tests first)**

In `src/core/reveal.test.ts`, replace the `expandCells` describe block with:

```ts
describe('expandCells', () => {
  test('by default one cell expands to itself plus two rings (19 cells)', () => {
    expect(expandCells([a]).size).toBe(19);
  });
  test('radius 1: one cell expands to itself plus 6 neighbours', () => {
    expect(expandCells([a], 1).size).toBe(7);
  });
  test('radius 1: two adjacent cells expand to 10 unique cells', () => {
    const neighbour = gridDisk(a, 1).find((c) => c !== a)!;
    expect(expandCells([a, neighbour], 1).size).toBe(10);
  });
  test('radius 0 keeps only the input cells', () => {
    expect([...expandCells([a, b], 0)].sort()).toEqual([a, b].sort());
  });
});
```

In `src/core/pipeline.test.ts`:
- change the import to `import { H3_RES, REVEAL_RADIUS } from './constants';`
- rename `'a single fix reveals its cell and 6 neighbours'` to `'a single fix reveals its cell and the rings around it'`, and change its `gridDisk(cellAt(LAT, LNG), 1)` to `gridDisk(cellAt(LAT, LNG), REVEAL_RADIUS)`;
- in `'two fixes within limits reveal the corridor between them'`, change `toBeGreaterThan(14)` to `toBeGreaterThan(38)`;
- in `'a jump beyond the limits is not filled'` and `'reveals after a long gap even if the implied speed is impossible'`, change `toBe(14)` to `toBe(38)` (two separate 19-cell disks).

Run: `rtk proxy npx jest src/core/reveal.test.ts src/core/pipeline.test.ts`
Expected: FAIL (default radius is still 1: 7 instead of 19, 14 instead of 38).

In `src/core/constants.ts` replace the REVEAL_RADIUS lines with:

```ts
/** Each revealed path cell also reveals neighbours within this many rings (2 → corridor ~650 m wide at res 10). */
export const REVEAL_RADIUS = 2;
```

Run: `rtk proxy npx jest`
Expected: all pass. If any other test hard-codes a one-ring count, update it to the two-ring count and say so in the report.

- [ ] **Step 2: `parentCells` (tests first)**

Add to `src/core/fog.test.ts` (add `cellToParent` and `getResolution` to the h3-js import and `parentCells` to the fog import):

```ts
describe('parentCells', () => {
  test('maps cells to their unique parents at the given resolution', () => {
    const disk = gridDisk(centre, 2);
    const parents = parentCells(disk, 8);
    expect(new Set(parents)).toEqual(new Set(disk.map((c) => cellToParent(c, 8))));
    expect(parents.length).toBe(new Set(parents).size);
    expect(parents.every((p) => getResolution(p) === 8)).toBe(true);
  });
  test('is empty without cells', () => {
    expect(parentCells([], 8)).toEqual([]);
  });
});
```

Run: `rtk proxy npx jest src/core/fog.test.ts`
Expected: FAIL: `parentCells` is not a function.

In `src/core/fog.ts`, add `cellToParent` to the h3-js import and add below `cellsBounds`:

```ts
/** The unique parents of cells at a coarser resolution, in first-seen order (coarse fog when zoomed out). */
export function parentCells(cells: Iterable<string>, res: number): string[] {
  const parents = new Set<string>();
  for (const c of cells) parents.add(cellToParent(c, res));
  return [...parents];
}
```

Run: `rtk proxy npx jest src/core/fog.test.ts`
Expected: PASS.

- [ ] **Step 3: Coarse fog in `FogSource` (tests first)**

Add to `src/config.ts`:

```ts
/** Below FINE_FOG_MIN_ZOOM the fog is drawn from the stored cells' parents at this resolution (~1 km hexagons). */
export const COARSE_FOG_RES = 8;
export const FINE_FOG_MIN_ZOOM = 12;
```

In `src/map/fogSource.test.ts`:
- change the fog import to `import { buildFog, cellsBounds, parentCells } from '../core/fog';` and add `import { COARSE_FOG_RES } from '../config';`
- add a helper below `shape`:

```ts
const coarse = (cells: string[]) => shape(buildFog(parentCells(cells, COARSE_FOG_RES)));
```

- in `'the first refresh adds every stored cell'` add `expect(shape(update.coarseFog)).toEqual(coarse(CELLS));`
- in `'later refreshes add only new cells and match a full build'` add `expect(shape(update.coarseFog)).toEqual(coarse(CELLS));`
- in `'after markReset the next refresh starts from scratch, though rowids restarted'` add `expect(shape(update.coarseFog)).toEqual(coarse(CELLS.slice(0, 50)));`
- in `'a reset to an empty table gives the all-fog world'` add `expect(update.coarseFog.geometry).toEqual(buildFog([]).geometry);`

Run: `rtk proxy npx jest src/map/fogSource.test.ts`
Expected: FAIL (`coarseFog` is undefined; TypeScript errors are acceptable as the failure here).

In `src/map/fogSource.ts`:
- imports: `import { COARSE_FOG_RES } from '../config';` and add `parentCells` to the `../core/fog` import;
- `FogUpdate` gains, after `fog`:

```ts
  /** The same fog from the cells' res-COARSE_FOG_RES parents, for zoomed-out views. */
  coarseFog: Feature<MultiPolygon>;
```

- add a field `private readonly coarse = new FogBuilder();` below `builder`;
- in the reset branch add `this.coarse.reset();`
- in the slice loop, after `this.builder.add(slice);`, add `this.coarse.add(parentCells(slice, COARSE_FOG_RES));`
- after `const fog = this.builder.toFeature();` add `const coarseFog = this.coarse.toFeature();`
- return `{ fog, coarseFog, cellCount: this.builder.size, ... }` (the rest unchanged).

Run: `rtk proxy npx jest src/map/fogSource.test.ts`
Expected: PASS.

- [ ] **Step 4: Ground-width soft edge**

Replace `src/map/fogStyle.ts` with:

```ts
import type { FillLayerSpecification, LineLayerSpecification } from '@maplibre/maplibre-react-native';
import { BANGKOK } from '../config';

const FOG_COLOR = '#10131c';

export const FOG_FILL_PAINT: FillLayerSpecification['paint'] = {
  'fill-color': FOG_COLOR,
  'fill-opacity': 0.8,
};

// Web Mercator metres per pixel at zoom 0, at Bangkok's latitude (M1 is tuned for Bangkok);
// it halves with every zoom level.
const M_PER_PX_Z0 = 156_543 * Math.cos((BANGKOK.lat * Math.PI) / 180);

type LineWidth = NonNullable<LineLayerSpecification['paint']>['line-width'];

/** A width that stays `metres` wide on the ground at every zoom (doubles per zoom level). */
function groundWidth(metres: number): LineWidth {
  const px0 = metres / M_PER_PX_Z0;
  return ['interpolate', ['exponential', 2], ['zoom'], 0, px0, 22, px0 * 2 ** 22];
}

/** A blurred line along every fog edge, for a soft boundary, `metres` wide on the ground. */
function edgePaint(metres: number): LineLayerSpecification['paint'] {
  return {
    'line-color': FOG_COLOR,
    'line-opacity': 0.5,
    'line-width': groundWidth(metres),
    'line-blur': groundWidth(metres * 0.85),
  };
}

/** ~14 px at zoom 15; under 2 px when zoomed out, so it never covers a corridor. */
export const FINE_EDGE_PAINT = edgePaint(60);
export const COARSE_EDGE_PAINT = edgePaint(400);
```

If TypeScript rejects the expression literal for `LineWidth`, check the installed `ExpressionSpecification` / `DataDrivenPropertyValueSpecification` types (from `@maplibre/maplibre-gl-style-spec`, re-exported or not) and type it from there; do not use `any`.

- [ ] **Step 5: Hook and map screen**

In `src/map/useFog.ts`:
- `FogState` gains `coarseFog: Feature<MultiPolygon>;` after `fog`;
- `EMPTY` becomes `{ fog: buildFog([]), coarseFog: buildFog([]), cellCount: 0, areaKm2: 0, bounds: null }`;
- the `setState` call becomes:

```ts
          setState({
            fog: update.fog,
            coarseFog: update.coarseFog,
            cellCount: update.cellCount,
            areaKm2: update.areaKm2,
            bounds: update.bounds,
          });
```

In `src/screens/MapScreen.tsx`:
- imports: `import { BANGKOK, DEFAULT_ZOOM, FINE_FOG_MIN_ZOOM, MAP_STYLE_URL } from '../config';` and `import { COARSE_EDGE_PAINT, FINE_EDGE_PAINT, FOG_FILL_PAINT } from '../map/fogStyle';`
- `const { fog, coarseFog, cellCount, areaKm2, bounds } = useFog();`
- replace the single `GeoJSONSource` with:

```tsx
        {/* Zoomed out: fog from ~1 km parent hexagons, so explored areas read as places, not lines. */}
        <GeoJSONSource id="fog-coarse" data={coarseFog}>
          <Layer id="fog-coarse-fill" type="fill" maxzoom={FINE_FOG_MIN_ZOOM} paint={FOG_FILL_PAINT} />
          <Layer id="fog-coarse-edge" type="line" maxzoom={FINE_FOG_MIN_ZOOM} paint={COARSE_EDGE_PAINT} />
        </GeoJSONSource>
        <GeoJSONSource id="fog" data={fog}>
          <Layer id="fog-fill" type="fill" minzoom={FINE_FOG_MIN_ZOOM} paint={FOG_FILL_PAINT} />
          <Layer id="fog-edge" type="line" minzoom={FINE_FOG_MIN_ZOOM} paint={FINE_EDGE_PAINT} />
        </GeoJSONSource>
```

Run: `rtk proxy npx jest && npm run typecheck`
Expected: all suites pass, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "feat(fog): two-ring reveal, coarse fog when zoomed out, ground-width soft edge"
```

- [ ] **Step 7: Device check (controller and user)**

JS-only change: a Release rebuild is needed to see it in Release (`npx expo run:ios --device 00008110-000A41CA3A39401E --configuration Release --no-bundler`). On the phone: Reset all data, Import GPX (the 50 km route) → corridor ~650 m wide; zoom out past 12 → ~1 km hexagons, no dark edge over corridors; then Stress fill 50,000 → note the first-load time; then import the second route (`fogmap-test-10km-b.gpx`) → note the small-update time at ~50k. Record in the spec under "Plan 2 device results".

---

### Task 10: Heatmap fog (added after the fog-look decision)

**Why:** The user wants fog that looks like fog (style D: today's dark colour, smooth feathered edges, no visible hexagons). Design and spike results: [docs/superpowers/specs/2026-10-29-heatmap-fog-design.md](../specs/2026-10-29-heatmap-fog-design.md). The spike (branch `spike/heatmap-fog`) showed MapLibre iOS fogs areas with no points, and a threshold ramp gives continuous soft clearings; 50k cells first load = 3,921 ms in Debug (polygon fog: 17,259 ms).

**Files:**
- Replace: `src/core/fog.ts`, `src/core/fog.test.ts`, `src/map/fogSource.ts`, `src/map/fogSource.test.ts`, `src/map/fogStyle.ts`
- Modify: `src/map/useFog.ts`, `src/screens/MapScreen.tsx`, `src/screens/DebugScreen.tsx`
- Delete: `src/core/fogBenchmark.ts`, `src/core/fogBenchmark.test.ts`

**Interfaces:**
- Consumes: `COARSE_FOG_RES`, `FINE_FOG_MIN_ZOOM`, `BANGKOK` (`src/config.ts`), `areaKm2` (`src/core/stats.ts`), `stressCells` (tests), MapLibre 11 `Layer type="heatmap"` with style-spec `paint`, `minzoom`, `maxzoom`; `HeatmapLayerSpecification` is exported by `@maplibre/maplibre-react-native`.
- Produces:
  - `src/core/fog.ts`: `Bounds`, `LngLat`, `cellCentre(cell): LngLat`, `pointsBounds(points: Iterable<LngLat>): Bounds | null`, `parentCells(cells, res): string[]`. `FogBuilder`, `buildFog`, `WORLD_RING`, `cellsBounds` are removed.
  - `src/map/fogSource.ts`: `FogPoints = FeatureCollection<Point>`, `NO_FOG_POINTS`, `FogUpdate` with `fog: FogPoints` and `coarseFog: FogPoints` (other fields unchanged), `FogSource` (constructor and methods unchanged).
  - `src/map/fogStyle.ts`: `FINE_FOG_PAINT`, `COARSE_FOG_PAINT` (heatmap paints). `FOG_FILL_PAINT`, `FINE_EDGE_PAINT`, `COARSE_EDGE_PAINT` are removed.

- [ ] **Step 1: Core helpers (tests first)**

Replace `src/core/fog.test.ts` with:

```ts
import { cellToLatLng, cellToParent, getResolution, gridDisk, latLngToCell } from 'h3-js';
import { H3_RES } from './constants';
import { cellCentre, parentCells, pointsBounds } from './fog';

const centre = latLngToCell(13.7563, 100.5018, H3_RES);

describe('cellCentre', () => {
  test('is the cell centre in GeoJSON [lng, lat] order', () => {
    const [lat, lng] = cellToLatLng(centre);
    expect(cellCentre(centre)).toEqual([lng, lat]);
  });
});

describe('pointsBounds', () => {
  test('is null without points', () => {
    expect(pointsBounds([])).toBeNull();
  });
  test('is the point itself for one point, as [west, south, east, north]', () => {
    expect(pointsBounds([[100.5, 13.7]])).toEqual([100.5, 13.7, 100.5, 13.7]);
  });
  test('covers every point', () => {
    expect(
      pointsBounds([
        [100.5, 13.9],
        [100.7, 13.7],
        [100.6, 13.8],
      ]),
    ).toEqual([100.5, 13.7, 100.7, 13.9]);
  });
});

describe('parentCells', () => {
  test('maps cells to their unique parents at the given resolution', () => {
    const disk = gridDisk(centre, 2);
    const parents = parentCells(disk, 8);
    expect(new Set(parents)).toEqual(new Set(disk.map((c) => cellToParent(c, 8))));
    expect(parents.length).toBe(new Set(parents).size);
    expect(parents.every((p) => getResolution(p) === 8)).toBe(true);
  });
  test('is empty without cells', () => {
    expect(parentCells([], 8)).toEqual([]);
  });
});
```

Run: `rtk proxy npx jest src/core/fog.test.ts`
Expected: FAIL (`cellCentre` and `pointsBounds` are not exported).

Replace `src/core/fog.ts` with:

```ts
import { cellToLatLng, cellToParent } from 'h3-js';

export type Bounds = [west: number, south: number, east: number, north: number];
/** A position in GeoJSON order. */
export type LngLat = [lng: number, lat: number];

/** A cell's centre. The fog is a heatmap of revealed cell centres; hexagons are never drawn. */
export function cellCentre(cell: string): LngLat {
  const [lat, lng] = cellToLatLng(cell);
  return [lng, lat];
}

/** Bounding box of the points, or null without points. Ignores the antimeridian. */
export function pointsBounds(points: Iterable<LngLat>): Bounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of points) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return west === Infinity ? null : [west, south, east, north];
}

/** The unique parents of cells at a coarser resolution, in first-seen order (coarse fog when zoomed out). */
export function parentCells(cells: Iterable<string>, res: number): string[] {
  const parents = new Set<string>();
  for (const c of cells) parents.add(cellToParent(c, res));
  return [...parents];
}
```

Delete `src/core/fogBenchmark.ts` and `src/core/fogBenchmark.test.ts` (`git rm`).

Run: `rtk proxy npx jest src/core`
Expected: PASS. (The map and Debug files still import removed names until Steps 2–4; typecheck is run at the end.)

- [ ] **Step 2: `FogSource` emits points (tests first)**

Replace `src/map/fogSource.test.ts` with:

```ts
import { COARSE_FOG_RES } from '../config';
import { cellCentre, parentCells, pointsBounds } from '../core/fog';
import { areaKm2 } from '../core/stats';
import { stressCells } from '../core/stress';
import { type FogPoints, FogSource, type NewCells } from './fogSource';

const BANGKOK = { lat: 13.7563, lng: 100.5018 };
const CELLS = stressCells(300, 1, BANGKOK);

const coords = (f: FogPoints) => f.features.map((p) => p.geometry.coordinates);
const centres = (cells: string[]) => cells.map(cellCentre);
const coarseCentres = (cells: string[]) => parentCells(cells, COARSE_FOG_RES).map(cellCentre);

/** A fake cells table: row i has rowid i + 1, and rowids restart from 1 after clear(), like SQLite. */
function table(initial: string[] = []) {
  let rows = [...initial];
  return {
    insert(ids: string[]) {
      rows.push(...ids);
    },
    clear() {
      rows = [];
    },
    readSince: async (after: number): Promise<NewCells> => {
      const ids = rows.slice(after);
      return { ids, lastRowid: after + ids.length };
    },
  };
}

const noPause = async () => {};
const now = () => 0;

test('the first refresh adds a point per stored cell and per coarse parent', async () => {
  const source = new FogSource(table(CELLS).readSince, noPause, now);
  const update = (await source.refresh())!;
  expect(update.cellCount).toBe(300);
  expect(update.added).toBe(300);
  expect(update.areaKm2).toBeCloseTo(areaKm2(CELLS), 9);
  expect(update.bounds).toEqual(pointsBounds(centres(CELLS)));
  expect(coords(update.fog)).toEqual(centres(CELLS));
  expect(coords(update.coarseFog)).toEqual(coarseCentres(CELLS));
  expect(update.coarseFog.features.length).toBeLessThan(300);
});

test('a refresh with nothing new returns null', async () => {
  const source = new FogSource(table(CELLS).readSince, noPause, now);
  await source.refresh();
  expect(await source.refresh()).toBeNull();
});

test('later refreshes add only new cells and match a full load', async () => {
  const t = table(CELLS.slice(0, 200));
  const source = new FogSource(t.readSince, noPause, now);
  const first = (await source.refresh())!;
  t.insert(CELLS.slice(200));
  const update = (await source.refresh())!;
  expect(update.added).toBe(100);
  expect(update.cellCount).toBe(300);
  expect(update.areaKm2).toBeCloseTo(areaKm2(CELLS), 9);
  expect(update.bounds).toEqual(pointsBounds(centres(CELLS)));
  expect(coords(update.fog)).toEqual(centres(CELLS));
  expect(coords(update.coarseFog)).toEqual(coarseCentres(CELLS));
  // The earlier result is not mutated, so the map sees a new value.
  expect(first.fog.features.length).toBe(200);
});

test('pauses between slices, not before the first one', async () => {
  let pauses = 0;
  const source = new FogSource(
    table(CELLS).readSince,
    async () => {
      pauses++;
    },
    now,
    100,
  );
  await source.refresh();
  expect(pauses).toBe(2);
});

test('ms counts work between pauses, not the pauses', async () => {
  let clock = 0;
  const source = new FogSource(
    table(CELLS).readSince,
    async () => {
      clock += 1_000;
    },
    () => clock,
    100,
  );
  expect((await source.refresh())!.ms).toBe(0);
});

test('after markReset the next refresh starts from scratch, though rowids restarted', async () => {
  const t = table(CELLS);
  const source = new FogSource(t.readSince, noPause, now);
  await source.refresh();
  t.clear();
  t.insert(CELLS.slice(0, 50));
  source.markReset();
  const update = (await source.refresh())!;
  expect(update.cellCount).toBe(50);
  expect(update.added).toBe(50);
  expect(update.areaKm2).toBeCloseTo(areaKm2(CELLS.slice(0, 50)), 9);
  expect(update.bounds).toEqual(pointsBounds(centres(CELLS.slice(0, 50))));
  expect(coords(update.fog)).toEqual(centres(CELLS.slice(0, 50)));
  expect(coords(update.coarseFog)).toEqual(coarseCentres(CELLS.slice(0, 50)));
});

test('a reset to an empty table leaves no points (all fog)', async () => {
  const t = table(CELLS);
  const source = new FogSource(t.readSince, noPause, now);
  await source.refresh();
  t.clear();
  source.markReset();
  const update = (await source.refresh())!;
  expect(update).toMatchObject({ cellCount: 0, added: 0, areaKm2: 0, bounds: null });
  expect(update.fog.features).toEqual([]);
  expect(update.coarseFog.features).toEqual([]);
});

test('after a failed refresh the next one starts from scratch', async () => {
  const t = table(CELLS);
  const asked: number[] = [];
  let fail = true;
  const source = new FogSource(
    async (after) => {
      asked.push(after);
      return t.readSince(after);
    },
    async () => {
      if (fail) throw new Error('interrupted');
    },
    now,
    100,
  );
  await expect(source.refresh()).rejects.toThrow('interrupted');
  fail = false;
  const update = (await source.refresh())!;
  expect(asked).toEqual([0, 0]);
  expect(update.cellCount).toBe(300);
  expect(update.added).toBe(300);
  expect(update.areaKm2).toBeCloseTo(areaKm2(CELLS), 9);
  expect(coords(update.fog)).toEqual(centres(CELLS));
  expect(coords(update.coarseFog)).toEqual(coarseCentres(CELLS));
});
```

Run: `rtk proxy npx jest src/map/fogSource.test.ts`
Expected: FAIL (`FogPoints` is not exported; `fog` has no `features`).

Replace `src/map/fogSource.ts` with:

```ts
import type { Feature, FeatureCollection, Point } from 'geojson';
import { COARSE_FOG_RES } from '../config';
import { type Bounds, type LngLat, cellCentre, parentCells, pointsBounds } from '../core/fog';
import { areaKm2 } from '../core/stats';

/** Cells stored after a rowid, as returned by cellsAddedSince. */
export type NewCells = { ids: string[]; lastRowid: number };

/** Revealed places as points; the map draws them as a heatmap that clears the fog. */
export type FogPoints = FeatureCollection<Point>;

export const NO_FOG_POINTS: FogPoints = { type: 'FeatureCollection', features: [] };

export type FogUpdate = {
  /** One point per stored cell, at its centre. */
  fog: FogPoints;
  /** One point per res-COARSE_FOG_RES parent of the stored cells, for zoomed-out views. */
  coarseFog: FogPoints;
  cellCount: number;
  areaKm2: number;
  bounds: Bounds | null;
  /** Cells added by this refresh. */
  added: number;
  /** JS time spent, not counting the pauses between slices. */
  ms: number;
};

// Keeps each blocking stretch of the first, large load short.
const SLICE_CELLS = 2_000;

function point(coordinates: LngLat): Feature<Point> {
  return { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates } };
}

function unionBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (a === null) return b;
  if (b === null) return a;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/**
 * Keeps the fog's points for the app's lifetime and adds only the cells stored
 * since the last refresh, in slices with a pause between them. A refresh costs
 * a few h3 lookups per new cell; the GPU heatmap does the drawing.
 */
export class FogSource {
  private points: Feature<Point>[] = [];
  private coarsePoints: Feature<Point>[] = [];
  private readonly coarseSeen = new Set<string>();
  private lastRowid = 0;
  private needsReset = false;
  private area = 0;
  private bounds: Bounds | null = null;

  constructor(
    private readonly readSince: (afterRowid: number) => Promise<NewCells>,
    private readonly pause: () => Promise<void>,
    private readonly now: () => number,
    private readonly sliceCells = SLICE_CELLS,
  ) {}

  /** Stored cells were deleted: the next refresh starts again from rowid 0. */
  markReset(): void {
    this.needsReset = true;
  }

  /** The fog after adding newly stored cells, or null when nothing changed. */
  async refresh(): Promise<FogUpdate | null> {
    const reset = this.needsReset;
    this.needsReset = false;
    try {
      const { ids, lastRowid } = await this.readSince(reset ? 0 : this.lastRowid);
      if (!reset && ids.length === 0) return null;
      let ms = 0;
      let start = this.now();
      if (reset) {
        this.points = [];
        this.coarsePoints = [];
        this.coarseSeen.clear();
        this.area = 0;
        this.bounds = null;
      }
      for (let i = 0; i < ids.length; i += this.sliceCells) {
        if (i > 0) {
          ms += this.now() - start;
          await this.pause();
          start = this.now();
        }
        const slice = ids.slice(i, i + this.sliceCells);
        const centres = slice.map(cellCentre);
        for (const c of centres) this.points.push(point(c));
        for (const parent of parentCells(slice, COARSE_FOG_RES)) {
          if (this.coarseSeen.has(parent)) continue;
          this.coarseSeen.add(parent);
          this.coarsePoints.push(point(cellCentre(parent)));
        }
        this.area += areaKm2(slice);
        this.bounds = unionBounds(this.bounds, pointsBounds(centres));
      }
      // Fresh arrays, so earlier results stay unchanged and the map sees new data.
      const fog: FogPoints = { type: 'FeatureCollection', features: [...this.points] };
      const coarseFog: FogPoints = { type: 'FeatureCollection', features: [...this.coarsePoints] };
      ms += this.now() - start;
      this.lastRowid = lastRowid;
      return {
        fog,
        coarseFog,
        cellCount: this.points.length,
        areaKm2: this.area,
        bounds: this.bounds,
        added: ids.length,
        ms,
      };
    } catch (e) {
      // The points may hold part of a slice: rebuild everything next time.
      this.needsReset = true;
      throw e;
    }
  }
}
```

Run: `rtk proxy npx jest src/map/fogSource.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 3: Heatmap style, hook and map**

Replace `src/map/fogStyle.ts` with:

```ts
import type { HeatmapLayerSpecification } from '@maplibre/maplibre-react-native';
import { BANGKOK } from '../config';

// Web Mercator metres per pixel at zoom 0, at Bangkok's latitude (M1 is tuned for Bangkok);
// it halves with every zoom level.
const M_PER_PX_Z0 = 156_543 * Math.cos((BANGKOK.lat * Math.PI) / 180);

type HeatmapPaint = NonNullable<HeatmapLayerSpecification['paint']>;

/**
 * Fog as a heatmap of revealed cell centres, the way games do fog of war: the
 * summed kernels are a blurred reveal mask and the colour ramp thresholds it:
 * full fog below density 0.05, clear above 0.25, a soft rim in between. The
 * kernel radius stays `radiusMetres` on the ground at every zoom.
 */
function fogPaint(radiusMetres: number): HeatmapPaint {
  const px0 = radiusMetres / M_PER_PX_Z0;
  return {
    'heatmap-radius': ['interpolate', ['exponential', 2], ['zoom'], 0, px0, 22, px0 * 2 ** 22],
    'heatmap-weight': 1,
    'heatmap-intensity': 2,
    'heatmap-color': [
      'interpolate',
      ['linear'],
      ['heatmap-density'],
      0,
      'rgba(16,19,28,0.82)',
      0.05,
      'rgba(16,19,28,0.82)',
      0.15,
      'rgba(16,19,28,0.4)',
      0.25,
      'rgba(16,19,28,0)',
    ],
  };
}

// Res-10 cell centres are ~145 m apart near Bangkok, res-8 parents ~1 km: the
// radii are about two spacings so neighbouring kernels merge.
export const FINE_FOG_PAINT = fogPaint(320);
export const COARSE_FOG_PAINT = fogPaint(1800);
```

In `src/map/useFog.ts`:
- replace `import type { Feature, MultiPolygon } from 'geojson';` with nothing (remove it) and `import { type Bounds, buildFog } from '../core/fog';` with `import type { Bounds } from '../core/fog';`
- change `import { FogSource } from './fogSource';` to `import { type FogPoints, FogSource, NO_FOG_POINTS } from './fogSource';`
- in `FogState`, `fog: FogPoints;` and `coarseFog: FogPoints;`
- `const EMPTY: FogState = { fog: NO_FOG_POINTS, coarseFog: NO_FOG_POINTS, cellCount: 0, areaKm2: 0, bounds: null };`

In `src/screens/MapScreen.tsx`:
- change the fogStyle import to `import { COARSE_FOG_PAINT, FINE_FOG_PAINT } from '../map/fogStyle';`
- replace the comment and both `GeoJSONSource` blocks with:

```tsx
        {/* Fog is a heatmap of revealed cell centres; zoomed out it uses ~1 km parent cells. */}
        <GeoJSONSource id="fog-coarse" data={coarseFog}>
          <Layer id="fog-coarse" type="heatmap" maxzoom={FINE_FOG_MIN_ZOOM} paint={COARSE_FOG_PAINT} />
        </GeoJSONSource>
        <GeoJSONSource id="fog" data={fog}>
          <Layer id="fog" type="heatmap" minzoom={FINE_FOG_MIN_ZOOM} paint={FINE_FOG_PAINT} />
        </GeoJSONSource>
```

- [ ] **Step 4: Remove the polygon benchmark from the Debug tab**

In `src/screens/DebugScreen.tsx` remove: the `fogBenchmark` import, `BENCHMARK_SIZES`, the `bench` state, the `benchmark` function, and in the Fog section the `Benchmark 10k / 25k / 50k` button and the `bench?.map(...)` rows. Keep "Last refresh" and "Last error". Remove any import that becomes unused.

Run: `rtk proxy npx jest && npm run typecheck`
Expected: all suites pass, typecheck clean. Also `rtk proxy grep -rn "FogBuilder\|buildFog\|WORLD_RING\|cellsBounds\|fogBenchmark\|EDGE_PAINT\|FOG_FILL_PAINT" src` finds nothing.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(fog): draw fog as a heatmap of revealed cells, drop polygon fog"
```

- [ ] **Step 6: Device check (controller and user)**

Release build (`npx expo run:ios --device 00008110-000A41CA3A39401E --configuration Release --no-bundler`). On the phone: Reset all data → map fully fogged; Import GPX (50 km route) → soft continuous clearing, zoomed in and out; Stress fill 50,000 → "Last refresh" first-load time, panning smooth; Import the second route (`fogmap-test-10km-b.gpx`) → small-update time at ~52k. Record under "Plan 2 device results" in the M1 spec.
