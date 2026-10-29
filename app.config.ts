import type { ConfigContext, ExpoConfig } from 'expo/config';

// Extends app.json. APPLE_TEAM_ID comes from .env.local; when it is unset,
// `expo run:ios` asks for a team on first build. All config plugins live here.
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'fogmap',
  slug: 'fogmap',
  scheme: 'fogmap',
  plugins: ['expo-router', '@maplibre/maplibre-react-native'],
  ios: {
    ...config.ios,
    bundleIdentifier: 'com.supaohm.fogmap',
    appleTeamId: process.env.APPLE_TEAM_ID,
    supportsTablet: false,
  },
  android: {
    ...config.android,
    package: 'com.supaohm.fogmap',
  },
});
