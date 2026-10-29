/** Debug tab: on unless the build sets EXPO_PUBLIC_DEBUG_SCREEN=0 (inlined at bundle time). */
export const DEBUG_SCREEN = process.env.EXPO_PUBLIC_DEBUG_SCREEN !== '0';

/** OpenFreeMap vector style (free, no key). MapTiler is the fallback if it fails. */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

export const BANGKOK = { lat: 13.7563, lng: 100.5018 };
export const DEFAULT_ZOOM = 12;

/** Fog is rebuilt at most this often. */
export const FOG_REFRESH_MS = 2000;

export const STRESS_FILL_CELLS = 50_000;
