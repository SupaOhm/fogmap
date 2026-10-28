# Milestone 1: Solo fog map (on-device)

## Goal

Prove the riskiest part of the product on a real iPhone: background tracking that reveals the map accurately, with acceptable battery use. No accounts, no server, no crew map, no widgets yet.

**Done means:** I can carry my iPhone for a normal day with the app in the background, open it in the evening, and see fog cleared along everywhere I went, with battery use I can measure and live with.

## Scope

**In**
- Permission flow for location ("When In Use", then upgrade to "Always")
- Background location recording
- H3 cell reveal with gap filling between fixes
- Fog rendering over a MapLibre map
- Stats: cells revealed, km² explored, today vs all-time
- Debug screen for battery and accuracy measurement
- Dev-only GPX import for testing without walking around
- Tracking on/off toggle

**Out (later milestones)**
- Accounts, Supabase sync, crew map
- Share cards, widgets, notifications
- City or district boundaries and "% of Bangkok explored"
- Monetization

## Design decisions

### Cells
- Store revealed cells at **H3 resolution 10** (cell edge about 66 m), so walking feels street-level.
- Later, sharing will use coarser parent cells (resolution 8 or 9) for privacy. Keep that possible: never depend on raw coordinates outside the in-memory buffer.
- Each fix reveals its own cell plus its immediate neighbours (`gridDisk(cell, 1)`). Make the radius a constant so it can be tuned.

### Filtering fixes
- Drop fixes with horizontal accuracy worse than 50 m (make it a constant).
- Drop fixes that imply an impossible speed from the previous accepted fix (over ~300 km/h).
- Record a speed bucket per fix (walking, cycling, vehicle) but **reveal all modes** for now. Whether driving should count is an open product decision, so keep the data needed to change it later.

### Gap filling
- Between two consecutive accepted fixes, fill the cells in between with `gridPathCells`, but only if the gap is under 2 km and under 10 minutes. Otherwise treat it as a jump (e.g. a flight or a tracking gap) and don't fill.

### Fog rendering
- Build the revealed area with `cellsToMultiPolygon`, then render the fog as a world-covering polygon with the revealed area as holes, in a MapLibre fill layer.
- Recompute incrementally or debounce it. Rendering must stay smooth with 50,000+ cells; test that with GPX import.
- Fog style: semi-opaque dark layer with a soft edge if MapLibre allows it cheaply. Polish can come later; correctness and performance first.

### Background tracking (iOS)
- `Location.startLocationUpdatesAsync` with a TaskManager task.
- Start with: accuracy `Balanced`, `distanceInterval` ~25 m, `pausesUpdatesAutomatically: true`, a suitable `activityType`, and `showsBackgroundLocationIndicator: false`.
- Expose two modes on the debug screen so they can be compared on battery:
  - **Efficient** (default): balanced accuracy, larger distance interval
  - **Precise**: high accuracy, smaller distance interval
- Configure `UIBackgroundModes: location` and clear permission strings via the Expo config.
- The background task must write to SQLite safely while the app is not in the foreground. Handle the app being killed and relaunched by iOS.

### Storage (SQLite)
- `cells(h3 TEXT PRIMARY KEY, first_seen INTEGER, last_seen INTEGER, visit_count INTEGER, mode TEXT)`
- `track_log(ts INTEGER, accuracy REAL, speed REAL, accepted INTEGER, battery REAL)`: diagnostics only, **no coordinates**, auto-pruned after 7 days
- Schema versioning so later migrations are painless

## Screens

1. **Map**: fog over the map, follow-me button, tracking on/off toggle, small stats chip (km² explored)
2. **Stats**: cells revealed and km² for today, this week and all-time
3. **Debug** (dev builds only):
   - tracking mode switch (Efficient / Precise)
   - fixes received vs accepted today, last fix time and accuracy
   - battery level samples over time
   - GPX import (reveals cells exactly as live tracking would)
   - reset all data

## Build order

1. Scaffold the Expo dev build with TypeScript, Jest, the folder structure and the libraries. Confirm `h3-js` runs under Hermes on iOS. If it doesn't, stop and report before choosing an alternative.
2. `src/core/`: cell reveal, filtering, gap filling, speed buckets, area stats, with unit tests.
3. SQLite schema and queries.
4. Map screen with MapLibre and fog rendering, fed by GPX import.
5. Foreground location, then background tracking with both modes.
6. Stats and debug screens.
7. Run on my iPhone and write `docs/m1-field-test.md` with a checklist I can follow during a day of real use.

## Acceptance criteria

- [ ] Unit tests pass for everything in `src/core/`
- [ ] GPX import of a long route (e.g. 50 km) reveals the expected corridor with no visible gaps
- [ ] Map stays smooth when panning with 50,000+ revealed cells
- [ ] With the app backgrounded and the phone locked, a 30-minute walk reveals the route
- [ ] After iOS kills the app, tracking resumes without reopening it (or the limitation is documented)
- [ ] No raw coordinates are written to disk (verify by inspecting the SQLite file)
- [ ] Debug screen shows enough data to estimate battery use per hour in each mode

## Open questions to report back on, not decide alone

- Battery use per mode after a real day
- Whether resolution 10 looks right on the map or should be 9 or 11
- Any iOS behaviour that makes reliable background reveal impossible without a different approach
