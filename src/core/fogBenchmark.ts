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
