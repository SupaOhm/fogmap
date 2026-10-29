# Heatmap fog design

**Date:** 2026-10-29. **Status:** approved by the user; spike passed on device. **Milestone:** M1, Plan 2 (Task 10).

## Why

After Task 9 the user said the fog "still feels like not fog": hexagon edges read as a game grid, not mist. In a browser comparison they chose **style D**: today's flat dark fog colour, with smooth, feathered edges and no visible hexagons. Hexagons remain the storage and computation grid only.

## How games do it

Fog of war in games is usually a low-resolution reveal mask (one texel per grid cell), blurred, then thresholded in the fog shader with a smoothstep: above a low threshold the area is clear, below it fogged, with a short soft band between. The blur merges neighbouring cells; the threshold turns the merged field into solid blobs with a feathered rim. (Sources: Tales of Fablecraft and other fog-of-war breakdowns; GTA V's internals are not public.)

MapLibre's heatmap layer is the same pipeline on the GPU: every point adds a Gaussian kernel (the blurred mask), and `heatmap-color` over `heatmap-density` is the threshold.

## Spike results (2026-10-29, iPhone 14, Debug build, branch `spike/heatmap-fog`)

- MapLibre Native on iOS paints the heatmap colour for density 0 across the whole viewport, so areas with no points are fogged. This was the main risk; it holds.
- A soft-glow ramp (clear only near density 1) shows separate dots. A threshold ramp (fog below 0.05, clear above 0.25) gives continuous soft-edged clearings. User: "works now".
- Refresh time: 1,949 cells (50 km route, two rings) = 176 ms; 50,000 cells first load = **3,921 ms** (polygon fog, same build: 17,259 ms; Release polygon fog: 7,888 ms).

## Design

**Data:** unchanged. Res-10 cells, two-ring reveal, new cells read by rowid, `'reset'` restarts from rowid 0.

**`FogSource` (src/map/fogSource.ts):** emits points instead of polygons.
- `fog`: `FeatureCollection<Point>`, one point per stored cell at its centre.
- `coarseFog`: one point per unique res-8 parent (`COARSE_FOG_RES`), at the parent's centre.
- Each refresh appends points for new cells only; reset, failure recovery, slicing, area and bounds behave as today. Bounds come from the point coordinates, so each cell's centre is computed once.
- No `FogBuilder` at runtime.

**Rendering (src/map/fogStyle.ts, src/screens/MapScreen.tsx):** two heatmap layers replace the four fill and line layers: coarse points below zoom 12 (`FINE_FOG_MIN_ZOOM`), fine points from zoom 12.
- `heatmap-radius`: constant on the ground via exponential zoom interpolation (fine 320 m, coarse 1,800 m; Bangkok latitude, as for Task 9's edge).
- `heatmap-intensity` 2, `heatmap-weight` 1.
- `heatmap-color`: fog `rgba(16,19,28,0.82)` up to density 0.05, `0.4` alpha at 0.15, clear at 0.25.
- The blurred line edge goes: the heatmap rim is the soft edge.

**Removed (no longer used):** `FogBuilder`, `buildFog`, `WORLD_RING`, the polygon fog tests, `src/core/fogBenchmark.ts`, and the Debug tab's "Benchmark 10k / 25k / 50k" button. Kept in `src/core/fog.ts`: `Bounds`, `cellsBounds`, `parentCells`. The Debug tab keeps "Last refresh", which now measures the heatmap path. The old code stays in git history.

## Device results (2026-10-29, iPhone 14)

- **Release, first heatmap version** (radius 320 m / 1,800 m): 1,949-cell route = 61 ms; 50,000 cells first load = **1,555 ms** (polygon fog: 7,888 ms). User: still "blurred hex", meaning the edge followed the hexagon grid.
- **Tuning (Debug, live reload):** the kernel sigma is now 1.2 cell spacings (radius ≈ 517 m fine, 3.6 km coarse), with intensity derived from cell area so a revealed area has a fixed density. It is boosted 2.5× because revealed areas looked tinted at the theoretical value. The ramp is fog below 0.2 and clear from 0.5. User: "looks way better", "lgtm".
- Not measured yet: a small update with ~50k cells stored (second route). Watch "Last refresh" in the field.

## Known limits

- Each refresh copies the point array and sends the whole collection to the native map; at 50k this transfer is not in the measured `ms`. The Release device check watches for a visible delay.
- Radius in metres is tuned for Bangkok's latitude; other latitudes are slightly off (fine for M1).
- No cloud texture: a heatmap layer can't use a pattern. Possible later.
- Edge softness and clearing width are tuned by eye; values live in `fogStyle.ts`.

## Testing

- Unit tests for `FogSource`: fine points equal the cell centres (as `[lng, lat]`), coarse points equal unique parent centres, incremental refresh adds only new points, reset and empty reset, failure recovery, `ms` excludes pauses, bounds and area as today.
- `npm run typecheck` for the map and Debug screens.
- Release device check: 50 km route look, 50k first-load time, a small update at 50k (second route), panning smoothness.
