import type { HeatmapLayerSpecification } from '@maplibre/maplibre-react-native';
import { BANGKOK } from '../config';

// Web Mercator metres per pixel at zoom 0, at Bangkok's latitude (M1 is tuned for Bangkok);
// it halves with every zoom level.
const M_PER_PX_Z0 = 156_543 * Math.cos((BANGKOK.lat * Math.PI) / 180);

type HeatmapPaint = NonNullable<HeatmapLayerSpecification['paint']>;

/**
 * Fog as a heatmap of revealed cell centres, the way games do fog of war: the
 * summed kernels are a blurred reveal mask and the colour ramp thresholds it:
 * full fog below density 0.05, clear above 0.25, a soft rim in between. The
 * kernel radius stays `radiusMetres` on the ground at every zoom.
 */
function fogPaint(radiusMetres: number): HeatmapPaint {
  const px0 = radiusMetres / M_PER_PX_Z0;
  return {
    'heatmap-radius': ['interpolate', ['exponential', 2], ['zoom'], 0, px0, 22, px0 * 2 ** 22],
    'heatmap-weight': 1,
    'heatmap-intensity': 2,
    'heatmap-color': [
      'interpolate',
      ['linear'],
      ['heatmap-density'],
      0,
      'rgba(16,19,28,0.82)',
      0.05,
      'rgba(16,19,28,0.82)',
      0.15,
      'rgba(16,19,28,0.4)',
      0.25,
      'rgba(16,19,28,0)',
    ],
  };
}

// Res-10 cell centres are ~145 m apart near Bangkok, res-8 parents ~1 km: the
// radii are about two spacings so neighbouring kernels merge.
export const FINE_FOG_PAINT = fogPaint(320);
export const COARSE_FOG_PAINT = fogPaint(1800);
