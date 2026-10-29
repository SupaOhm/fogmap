import { Tabs } from 'expo-router/js-tabs';
import { DEBUG_SCREEN } from '../config';

export default function Layout() {
  return (
    <Tabs>
      <Tabs.Screen name="index" options={{ title: 'Map', headerShown: false }} />
      {/* href: null hides the tab when the build turns the Debug screen off. */}
      <Tabs.Screen name="debug" options={{ title: 'Debug', href: DEBUG_SCREEN ? undefined : null }} />
    </Tabs>
  );
}
