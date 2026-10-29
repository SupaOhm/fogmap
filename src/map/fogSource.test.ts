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
