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
