import type { ConfigContext, ExpoConfig } from 'expo/config';

// Extends app.json. APPLE_TEAM_ID comes from .env.local (see Task 2); when it is
// unset, `expo run:ios` asks for a team on first build.
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'fogmap',
  slug: 'fogmap',
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
