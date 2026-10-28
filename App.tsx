import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { runH3SelfCheck } from './src/core/h3SelfCheck';

const isHermes =
  typeof (globalThis as { HermesInternal?: unknown }).HermesInternal !== 'undefined';
const results = runH3SelfCheck();

export default function App() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>h3-js self-check</Text>
      <Text>Engine: {isHermes ? 'Hermes' : 'NOT Hermes'}</Text>
      {results.map((r) => (
        <Text key={r.name} style={r.ok ? styles.ok : styles.fail}>
          {r.ok ? 'PASS' : 'FAIL'} {r.name}: {r.detail}
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
