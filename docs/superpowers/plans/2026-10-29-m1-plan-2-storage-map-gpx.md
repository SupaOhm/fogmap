# M1 Plan 2: Storage, Map and GPX Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revealed cells live in SQLite, the Map tab draws fog over a MapLibre map, and the Debug tab can import a GPX route, stress-fill 50,000 cells, benchmark the fog, and reset data. Fog performance is measured in a Release build before the map depends on it.

**Architecture:**
- `src/db/` talks to SQLite through a small `Db` interface. On device it wraps `expo-sqlite`; in Jest it wraps Node's built-in `node:sqlite`, so the real SQL runs in unit tests.
- GPX import and stress fill write cells through the same `upsertCells` that live tracking will use in Plan 3. An in-process event tells the map to refresh.
- The map rebuilds the whole fog shape with `buildFog`, at most once every 2 s and only while the app is in the foreground (spec option A).

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
| `src/db/cells.ts` | `upsertCells`, `allCellIds`, `cellCount` |
| `src/db/events.ts` | `onCellsChanged`, `emitCellsChanged` |
| `src/db/devData.ts` | `importFixes`, `stressFill`, `resetAllData` (Debug tools) |
| `src/map/throttle.ts` | `createThrottle`: at most one run per interval, no overlap |
| `src/map/fogStats.ts` | Last `buildFog` duration and cell count, for the Debug tab |
| `src/map/fogStyle.ts` | Fog fill and soft-edge paint |
| `src/map/useFog.ts` | Loads cells, builds fog (throttled, foreground only) |
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
  CREATE TABLE cells (
    h3 TEXT PRIMARY KEY NOT NULL,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    visit_count INTEGER NOT NULL,
    mode TEXT NOT NULL
  ) WITHOUT ROWID;
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
  - `export async function allCellIds(db: Db): Promise<string[]>` (sorted)
  - `export async function cellCount(db: Db): Promise<number>`
  - `export function onCellsChanged(listener: () => void): () => void` (returns unsubscribe)
  - `export function emitCellsChanged(): void`

- [ ] **Step 1: Write the failing cell tests**

Create `src/db/cells.test.ts`:

```ts
import type { RevealedCell } from '../core/types';
import { allCellIds, cellCount, upsertCells } from './cells';
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

test('allCellIds returns every id, sorted', async () => {
  const db = await freshDb();
  await upsertCells(
    db,
    new Map([
      ['b', cell('walk', 1, 1)],
      ['a', cell('walk', 1, 1)],
    ]),
  );
  expect(await allCellIds(db)).toEqual(['a', 'b']);
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

export async function allCellIds(db: Db): Promise<string[]> {
  const rows = await db.getAllAsync<{ h3: string }>('SELECT h3 FROM cells ORDER BY h3', []);
  return rows.map((r) => r.h3);
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
import { emitCellsChanged, onCellsChanged } from './events';

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
```

- [ ] **Step 5: Run them to verify they fail**

Run: `rtk proxy npx jest src/db/events.test.ts`
Expected: FAIL: cannot find module `./events`.

- [ ] **Step 6: Implement**

Create `src/db/events.ts`:

```ts
type Listener = () => void;

const listeners = new Set<Listener>();

/** In-process notice that the cells table changed (GPX import, stress fill, reset; tracking in Plan 3). */
export function onCellsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitCellsChanged(): void {
  for (const listener of [...listeners]) listener();
}
```

Run: `rtk proxy npx jest && npm run typecheck`
Expected: all suites pass, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/db/cells.ts src/db/cells.test.ts src/db/events.ts src/db/events.test.ts
git commit -m "feat(db): cell upsert with slowest-bucket merge, cell queries, change event"
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

test('resetAllData empties every table and notifies', async () => {
  const db = await freshDb();
  await stressFill(db, 50, 0, BANGKOK);
  await db.runAsync(
    "INSERT INTO track_log (ts, accepted, tracking_mode) VALUES (1, 1, 'efficient')",
    [],
  );
  await db.runAsync("INSERT INTO settings VALUES ('tracking_enabled', '1')", []);
  let changes = 0;
  const off = onCellsChanged(() => changes++);
  await resetAllData(db);
  off();
  expect([await count(db, 'cells'), await count(db, 'track_log'), await count(db, 'settings')]).toEqual([0, 0, 0]);
  expect(changes).toBe(1);
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
  emitCellsChanged();
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

### Task 5: Fog refresh throttle and fog timing

**Files:**
- Create: `src/map/throttle.ts`, `src/map/throttle.test.ts`, `src/map/fogStats.ts`, `src/map/fogStats.test.ts`

**Interfaces:**
- Produces:
  - `export type Throttle = { request(): void; cancel(): void }`
  - `export function createThrottle(run: () => Promise<void>, intervalMs: number, onError: (e: unknown) => void): Throttle`
  - `export type FogBuild = { ms: number; cells: number; at: number }`
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

- [ ] **Step 4: Write the failing fog-stats test**

Create `src/map/fogStats.test.ts`:

```ts
import { fogStats, recordFogBuild, recordFogError } from './fogStats';

test('keeps the last build and the last error until the next success', () => {
  expect(fogStats()).toEqual({ lastBuild: null, lastError: null });
  recordFogBuild({ ms: 12, cells: 100, at: 1 });
  recordFogError(new Error('db closed'));
  expect(fogStats()).toEqual({ lastBuild: { ms: 12, cells: 100, at: 1 }, lastError: 'db closed' });
  recordFogBuild({ ms: 15, cells: 120, at: 2 });
  expect(fogStats()).toEqual({ lastBuild: { ms: 15, cells: 120, at: 2 }, lastError: null });
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
export type FogBuild = { ms: number; cells: number; at: number };

let lastBuild: FogBuild | null = null;
let lastError: string | null = null;

/** Shown on the Debug tab: how long the last fog rebuild took. */
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
git commit -m "feat(map): fog refresh throttle and fog build timing"
```

---

### Task 6: App shell with expo-router and the fog map

**Files:**
- Modify: `package.json`, `package-lock.json`, `app.json` (only if `expo install` added plugins), `app.config.ts`, `index.ts`
- Delete: `App.tsx`
- Create: `src/config.ts`, `src/map/fogStyle.ts`, `src/map/useFog.ts`, `src/screens/MapScreen.tsx`, `src/app/_layout.tsx`, `src/app/index.tsx`

**Interfaces:**
- Consumes: `buildFog`, `cellsBounds`, `Bounds` (Task 1), `areaKm2` (Plan 1), `getDb` (Task 2), `allCellIds`, `onCellsChanged` (Task 3), `createThrottle`, `recordFogBuild`, `recordFogError` (Task 5).
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
import { type Bounds, buildFog, cellsBounds } from '../core/fog';
import { areaKm2 } from '../core/stats';
import { allCellIds } from '../db/cells';
import { onCellsChanged } from '../db/events';
import { getDb } from '../db/open';
import { recordFogBuild, recordFogError } from './fogStats';
import { createThrottle } from './throttle';

export type FogState = {
  fog: Feature<MultiPolygon>;
  cellCount: number;
  areaKm2: number;
  bounds: Bounds | null;
};

const EMPTY: FogState = { fog: buildFog([]), cellCount: 0, areaKm2: 0, bounds: null };

/**
 * Fog for the map: rebuilt from every stored cell when cells change or the app
 * returns to the foreground, at most once every FOG_REFRESH_MS, never in the background.
 */
export function useFog(): FogState {
  const [state, setState] = useState<FogState>(EMPTY);

  useEffect(() => {
    let mounted = true;
    const throttle = createThrottle(
      async () => {
        const ids = await allCellIds(await getDb());
        const start = performance.now();
        const fog = buildFog(ids);
        recordFogBuild({ ms: performance.now() - start, cells: ids.length, at: Date.now() });
        if (mounted) {
          setState({ fog, cellCount: ids.length, areaKm2: areaKm2(ids), bounds: cellsBounds(ids) });
        }
      },
      FOG_REFRESH_MS,
      recordFogError,
    );

    throttle.request();
    const offCells = onCellsChanged(() => {
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
          Last rebuild:{' '}
          {fog.lastBuild
            ? `${Math.round(fog.lastBuild.ms)} ms for ${fog.lastBuild.cells.toLocaleString()} cells`
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
   - the Debug tab's "Last rebuild" shows a time for 50,000 cells;
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
   - **GPX corridor:** Debug → Reset all data, then Import GPX…, then Map → Fit revealed. Zoom along the route: the corridor must have **no visible gaps**. Note the cell count and the "Last rebuild" time.
   - **Fog shape:** the fog should be dark everywhere except the corridor. If the whole map is clear, or the revealed area is dark and the rest clear, the ring winding is wrong. Report it, and fix `buildFog` to reverse the rings before going on.
   - **Soft edge:** decide with the user whether the blurred edge looks right; if not, remove the `fog-edge` layer.
   - **50,000 cells:** Debug → Stress fill 50,000, then go to Map. Pan and zoom for 30 s. It must stay smooth (no visible stutter while panning). Note the "Last rebuild" time.
   - **Resolution 10 look:** take a screenshot zoomed into a street-level part of the corridor, for the open question on resolution.
4. Record the results in the spec, in a new subsection `### Plan 2 device results (YYYY-MM-DD, Release)` under "Fog performance": GPX cells and rebuild ms, corridor gaps yes/no, 50k rebuild ms, panning smooth yes/no, soft edge kept or removed, and the user's first impression of resolution 10.
5. Commit with `docs(spec): record Plan 2 device results`.
