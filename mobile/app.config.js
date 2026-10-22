// One codebase, two store apps (like Uber / Uber Driver):
//   customer → "MyRide"        np.myride.app     (customers book rides, parcels, logistics; can apply to become a rider)
//   drive    → "MyRide Drive"  np.myride.driver  (approved riders drive and earn)
// Choose with APP_VARIANT=drive (see scripts/start.js and eas.json).
const VARIANT = process.env.APP_VARIANT === 'drive' ? 'drive' : 'customer';
const DRIVER = VARIANT === 'drive';
const asset = (name) => `./assets/${name}${DRIVER ? '-driver' : ''}.png`; // each app has its own icon set

module.exports = ({ config }) => ({
  ...config,
  name: DRIVER ? 'MyRide Drive' : 'MyRide',
  slug: DRIVER ? 'myride-drive' : 'myride',
  scheme: DRIVER ? 'myridedrive' : 'myride',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: asset('icon'),
  splash: { image: asset('splash-icon'), resizeMode: 'contain', imageWidth: 200, backgroundColor: DRIVER ? '#101a19' : '#0b7a6f' },
  ios: {
    bundleIdentifier: DRIVER ? 'np.myride.driver' : 'np.myride.app',
    supportsTablet: false,
    infoPlist: {
      NSCameraUsageDescription: DRIVER
        ? 'MyRide Drive uses the camera for your identity selfie checks and document photos.'
        : 'MyRide uses the camera for proof-of-delivery photos.',
      ...(DRIVER ? { UIBackgroundModes: ['location', 'audio'] } : {}), // keep navigation + voice running on a trip
    },
  },
  android: {
    package: DRIVER ? 'np.myride.driver' : 'np.myride.app',
    adaptiveIcon: {
      backgroundColor: DRIVER ? '#101a19' : '#0b7a6f',
      foregroundImage: asset('android-icon-foreground'),
      backgroundImage: asset('android-icon-background'),
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', ...(DRIVER ? ['CAMERA', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION'] : [])],
  },
  web: { favicon: './assets/favicon.png', bundler: 'metro' },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-web-browser',
    ['expo-notifications', { color: DRIVER ? '#075a52' : '#0b7a6f' }],
    [
      'expo-location',
      {
        locationWhenInUsePermission: DRIVER
          ? 'MyRide Drive needs your location to send you nearby trips and give turn-by-turn directions.'
          : 'MyRide uses your location to set your pickup point.',
        locationAlwaysAndWhenInUsePermission: 'MyRide Drive keeps sharing your location with the rider during an active trip, even if the app is in the background.',
        isAndroidBackgroundLocationEnabled: DRIVER,
        isIosBackgroundLocationEnabled: DRIVER,
      },
    ],
    [
      'react-native-maps',
      {
        // Needed for store builds (Expo Go works without keys). Restrict keys to the app package / bundle id.
        androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_KEY,
        iosGoogleMapsApiKey: process.env.GOOGLE_MAPS_IOS_KEY,
      },
    ],
  ],
  experiments: { typedRoutes: true },
  extra: {
    variant: VARIANT,
    apiUrl: process.env.EXPO_PUBLIC_API_URL || null, // e.g. https://api.myride.com.np in production
    // Push notifications need the EAS project id (`npx eas-cli@latest init` prints it); without it push is skipped.
    // EAS_PROJECT_ID_RIDER is the old name for the customer app's id (kept so existing EAS secrets still work).
    eas: { projectId: (DRIVER ? process.env.EAS_PROJECT_ID_DRIVER : process.env.EAS_PROJECT_ID_CUSTOMER || process.env.EAS_PROJECT_ID_RIDER) || undefined },
  },
});
