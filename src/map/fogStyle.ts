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
