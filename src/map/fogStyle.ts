import type { FillLayerSpecification, LineLayerSpecification } from '@maplibre/maplibre-react-native';

const FOG_COLOR = '#10131c';

export const FOG_FILL_PAINT: FillLayerSpecification['paint'] = {
  'fill-color': FOG_COLOR,
  'fill-opacity': 0.8,
};

/** A blurred line along every fog edge, for a soft boundary. Drop it if it looks wrong on device. */
export const FOG_EDGE_PAINT: LineLayerSpecification['paint'] = {
  'line-color': FOG_COLOR,
  'line-opacity': 0.5,
  'line-width': 14,
  'line-blur': 12,
};
