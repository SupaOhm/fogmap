import type { Feature, MultiPolygon, Position } from 'geojson';
import { COARSE_FOG_RES } from '../config';
import { buildFog, cellsBounds, parentCells } from '../core/fog';
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

const coarse = (cells: string[]) => shape(buildFog(parentCells(cells, COARSE_FOG_RES)));

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
  expect(shape(update.coarseFog)).toEqual(coarse(CELLS));
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
  expect(shape(update.coarseFog)).toEqual(coarse(CELLS));
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
  expect(shape(update.coarseFog)).toEqual(coarse(CELLS.slice(0, 50)));
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
  expect(update.coarseFog.geometry).toEqual(buildFog([]).geometry);
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
