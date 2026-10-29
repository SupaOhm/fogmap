import { Tabs } from 'expo-router/js-tabs';

export default function Layout() {
  return (
    <Tabs>
      <Tabs.Screen name="index" options={{ title: 'Map', headerShown: false }} />
    </Tabs>
  );
}
