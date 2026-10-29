import type { HeatmapLayerSpecification } from '@maplibre/maplibre-react-native';
import { BANGKOK } from '../config';

// Web Mercator metres per pixel at zoom 0, at Bangkok's latitude (M1 is tuned for Bangkok);
// it halves with every zoom level.
const M_PER_PX_Z0 = 156_543 * Math.cos((BANGKOK.lat * Math.PI) / 180);

type HeatmapPaint = NonNullable<HeatmapLayerSpecification['paint']>;

// MapLibre's heatmap kernel is w * intensity * GAUSS_COEF * exp(-4.5 (r/R)^2): a Gaussian with
// sigma = R / 3, whose integral is GAUSS_COEF * 2 pi sigma^2 (GAUSS_COEF = 1 / sqrt(2 pi)).
const GAUSS_COEF = 0.3989422804014327;
// Blur wider than the cell spacing hides the hexagon grid; ~1.2 spacings leaves no visible ripple.
const SIGMA_PER_SPACING = 1.2;
// Tuned on the iPhone: at the theoretical intensity, fully revealed areas stayed slightly tinted.
const INTENSITY_BOOST = 2.5;

/**
 * Fog as a heatmap of revealed cell centres, the way games do fog of war: the
 * summed kernels are a blurred reveal mask, and the colour ramp thresholds it.
 * Intensity is set so a fully revealed area has density 1; a straight edge of
 * revealed cells then sits at 0.5, so the ramp (fog below 0.2, clear from 0.5)
 * puts the soft rim just outside the real boundary. Sizes stay constant on the
 * ground at every zoom.
 */
function fogPaint(cellAreaM2: number): HeatmapPaint {
  const spacing = Math.sqrt((2 * cellAreaM2) / Math.sqrt(3)); // hexagon centre-to-centre
  const sigma = SIGMA_PER_SPACING * spacing;
  const px0 = (3 * sigma) / M_PER_PX_Z0;
  return {
    'heatmap-radius': ['interpolate', ['exponential', 2], ['zoom'], 0, px0, 22, px0 * 2 ** 22],
    'heatmap-weight': 1,
    'heatmap-intensity': (INTENSITY_BOOST * cellAreaM2) / (GAUSS_COEF * 2 * Math.PI * sigma * sigma),
    'heatmap-color': [
      'interpolate',
      ['linear'],
      ['heatmap-density'],
      0,
      'rgba(16,19,28,0.82)',
      0.2,
      'rgba(16,19,28,0.82)',
      0.5,
      'rgba(16,19,28,0)',
    ],
  };
}

// Cell areas near Bangkok: res 10 = 0.01788 km² (h3 self-check); a res-8 parent holds 49 of them.
const FINE_CELL_M2 = 17_880;
export const FINE_FOG_PAINT = fogPaint(FINE_CELL_M2);
export const COARSE_FOG_PAINT = fogPaint(49 * FINE_CELL_M2);
