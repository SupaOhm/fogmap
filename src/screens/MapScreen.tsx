import { Camera, type CameraRef, GeoJSONSource, Layer, Map as MapView } from '@maplibre/maplibre-react-native';
import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BANGKOK, DEFAULT_ZOOM, FINE_FOG_MIN_ZOOM, MAP_STYLE_URL } from '../config';
import { COARSE_FOG_PAINT, FINE_FOG_PAINT } from '../map/fogStyle';
import { useFog } from '../map/useFog';

const FIT_PADDING = { top: 120, right: 60, bottom: 60, left: 60 };

export function MapScreen() {
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraRef>(null);
  const { fog, coarseFog, cellCount, areaKm2, bounds } = useFog();

  const fitRevealed = () => {
    if (bounds) camera.current?.fitBounds(bounds, { padding: FIT_PADDING, duration: 800 });
  };

  return (
    <View style={styles.root}>
      <MapView style={styles.root} mapStyle={MAP_STYLE_URL}>
        <Camera
          ref={camera}
          initialViewState={{ center: [BANGKOK.lng, BANGKOK.lat], zoom: DEFAULT_ZOOM }}
        />
        {/* Fog is a heatmap of revealed cell centres; zoomed out it uses ~1 km parent cells. */}
        <GeoJSONSource id="fog-coarse" data={coarseFog}>
          <Layer id="fog-coarse" type="heatmap" maxzoom={FINE_FOG_MIN_ZOOM} paint={COARSE_FOG_PAINT} />
        </GeoJSONSource>
        <GeoJSONSource id="fog" data={fog}>
          <Layer id="fog" type="heatmap" minzoom={FINE_FOG_MIN_ZOOM} paint={FINE_FOG_PAINT} />
        </GeoJSONSource>
      </MapView>
      <View style={[styles.overlay, { top: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.chip}>
          <Text style={styles.chipText}>
            {areaKm2.toFixed(2)} km² · {cellCount.toLocaleString()} cells
          </Text>
        </View>
        {bounds && (
          <Pressable style={styles.chip} onPress={fitRevealed} accessibilityRole="button">
            <Text style={styles.chipText}>Fit revealed</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between' },
  chip: { backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: 14, fontWeight: '600', color: '#10131c' },
});
