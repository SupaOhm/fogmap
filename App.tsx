import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Button, ScrollView, StyleSheet, Text } from 'react-native';
import { type FogBenchmarkRow, runFogBenchmark } from './src/core/fogBenchmark';
import { runH3SelfCheck } from './src/core/h3SelfCheck';

const isHermes =
  typeof (globalThis as { HermesInternal?: unknown }).HermesInternal !== 'undefined';
const results = runH3SelfCheck();
const BANGKOK = { lat: 13.7563, lng: 100.5018 };
const SIZES = [10_000, 25_000, 50_000];

export default function App() {
  const [bench, setBench] = useState<FogBenchmarkRow[] | null>(null);
  const [running, setRunning] = useState(false);

  const runBenchmark = () => {
    setRunning(true);
    // Let "Running…" render before the JS thread is blocked.
    setTimeout(() => {
      setBench(runFogBenchmark(SIZES, BANGKOK, () => performance.now()));
      setRunning(false);
    }, 50);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>h3-js self-check</Text>
      <Text>
        Engine: {isHermes ? 'Hermes' : 'NOT Hermes'} · Build: {__DEV__ ? 'Debug' : 'Release'}
      </Text>
      {results.map((r) => (
        <Text key={r.name} style={r.ok ? styles.ok : styles.fail}>
          {r.ok ? 'PASS' : 'FAIL'} {r.name}: {r.detail}
        </Text>
      ))}
      <Text style={styles.title}>Fog benchmark</Text>
      <Button title={running ? 'Running…' : 'Run 10k / 25k / 50k'} onPress={runBenchmark} disabled={running} />
      {bench?.map((r) => (
        <Text key={r.cells}>
          {r.cells.toLocaleString()} cells: {Math.round(r.ms)} ms, {r.polygons} polygons,{' '}
          {r.vertices.toLocaleString()} vertices
        </Text>
      ))}
      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 80, gap: 8 },
  title: { fontSize: 20, fontWeight: '600' },
  ok: { color: '#1a7f37' },
  fail: { color: '#cf222e', fontWeight: '600' },
});
