import { getDocumentAsync } from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useFocusEffect } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Alert, Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BANGKOK, STRESS_FILL_CELLS } from '../config';
import { parseGpx } from '../core/gpx';
import { runH3SelfCheck } from '../core/h3SelfCheck';
import { cellCount } from '../db/cells';
import { importFixes, resetAllData, stressFill } from '../db/devData';
import { onCellsChanged } from '../db/events';
import { getDb } from '../db/open';
import { fogStats } from '../map/fogStats';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function DebugScreen() {
  const [cells, setCells] = useState<number | null>(null);
  const [fog, setFog] = useState(fogStats);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [selfCheck] = useState(runH3SelfCheck);

  const refresh = useCallback(() => {
    setFog(fogStats());
    getDb()
      .then(cellCount)
      .then(setCells, (e: unknown) => setStatus(`Error: ${message(e)}`));
  }, []);
  useFocusEffect(refresh);
  useEffect(() => onCellsChanged(refresh), [refresh]);

  const run = async (label: string, action: () => Promise<string>) => {
    setBusy(true);
    setStatus(`${label}…`);
    try {
      setStatus(await action());
    } catch (e) {
      setStatus(`${label} failed: ${message(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const importGpx = () =>
    run('Importing GPX', async () => {
      const picked = await getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      const asset = picked.canceled ? undefined : picked.assets[0];
      if (!asset) return 'Import cancelled';
      const fixes = parseGpx(await new File(asset.uri).text(), Date.now());
      const r = await importFixes(await getDb(), fixes);
      return `${asset.name}: ${r.accepted}/${r.fixes} fixes accepted, ${r.cells.toLocaleString()} cells`;
    });

  const fill = () =>
    run('Stress fill', async () => {
      const n = await stressFill(await getDb(), STRESS_FILL_CELLS, Date.now(), BANGKOK);
      return `Stress fill wrote ${n.toLocaleString()} cells`;
    });

  const confirmReset = () =>
    Alert.alert('Reset all data?', 'Deletes every revealed cell, log row and setting.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: () =>
          void run('Reset', async () => {
            await resetAllData(await getDb());
            return 'All data deleted';
          }),
      },
    ]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Section title="Data">
        <Text>Cells stored: {cells === null ? '…' : cells.toLocaleString()}</Text>
        <Text>Build: {__DEV__ ? 'Debug' : 'Release'}</Text>
      </Section>

      <Section title="Fog">
        <Text>
          Last refresh:{' '}
          {fog.lastBuild
            ? `${Math.round(fog.lastBuild.ms)} ms, +${fog.lastBuild.added.toLocaleString()} → ${fog.lastBuild.cells.toLocaleString()} cells`
            : 'none yet (open the Map tab)'}
        </Text>
        {fog.lastError && <Text style={styles.fail}>Last error: {fog.lastError}</Text>}
      </Section>

      <Section title="Test data">
        <Button title="Import GPX…" onPress={importGpx} disabled={busy} />
        <Button
          title={`Stress fill ${STRESS_FILL_CELLS.toLocaleString()} cells`}
          onPress={fill}
          disabled={busy}
        />
        <Button title="Reset all data" color="#cf222e" onPress={confirmReset} disabled={busy} />
        {status !== '' && <Text>{status}</Text>}
      </Section>

      <Section title="h3-js self-check">
        {selfCheck.map((r) => (
          <Text key={r.name} style={r.ok ? styles.ok : styles.fail}>
            {r.ok ? 'PASS' : 'FAIL'} {r.name}: {r.detail}
          </Text>
        ))}
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.title}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 20 },
  section: { gap: 6 },
  title: { fontSize: 17, fontWeight: '600' },
  ok: { color: '#1a7f37' },
  fail: { color: '#cf222e', fontWeight: '600' },
});
