# fogmap (working name)

A mobile app where the map starts covered in fog and clears wherever the user physically goes, like the GTA map. Long-term: a shared "crew" map that combines members' explored areas, share cards, and home screen widgets.

**Current milestone:** solo fog map only. See [docs/milestone-1.md](docs/milestone-1.md).

## Stack

- Expo (React Native), TypeScript, **development build** (not Expo Go: background location and MapLibre need native code)
- Map: `@maplibre/maplibre-react-native` with a free vector style (OpenFreeMap first; MapTiler as fallback)
- Background location: `expo-location` + `expo-task-manager`
- Spatial index: H3 via `h3-js`
- Local storage: `expo-sqlite`
- Tests: Jest for pure logic
- Primary test device: iPhone. Android must compile but is not tuned yet.

Before installing anything, check the current versions and Expo SDK compatibility of each library. Don't trust version numbers from memory.

## Principles

- **Battery and accuracy are the product.** If tracking drains the battery or misses areas, nothing else matters. Every tracking change should be measurable on the debug screen.
- **Private by design.** Store H3 cells, not GPS tracks. No raw coordinates persist beyond a short in-memory buffer used for gap filling. Nothing leaves the device in this milestone: no accounts, no analytics, no network calls except map tiles.
- **Keep the core pure.** Cell math, gap filling, filtering and stats live in `src/core/` as pure TypeScript functions with unit tests and no React or Expo imports.
- **Small, reviewable steps.** Commit after each working step with a clear message.

## Conventions

- `src/core/`: pure logic (cells, filters, stats), fully unit-tested
- `src/tracking/`: background task, permission flow, tracking modes
- `src/db/`: SQLite schema, migrations, queries
- `src/map/`: fog rendering and map screen
- `src/screens/`: Map, Stats, Debug
- Strict TypeScript. No `any` without a comment explaining why.
