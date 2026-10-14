// One codebase, two store apps (like Uber / Uber Driver):
//   rider  → "MyRide"        np.myride.app
//   driver → "MyRide Drive"  np.myride.driver
// Choose with APP_VARIANT=driver (see scripts/start.js and eas.json).
const VARIANT = process.env.APP_VARIANT === 'driver' ? 'driver' : 'rider';
const DRIVER = VARIANT === 'driver';

module.exports = ({ config }) => ({
  ...config,
  name: DRIVER ? 'MyRide Drive' : 'MyRide',
  slug: DRIVER ? 'myride-drive' : 'myride',
  scheme: DRIVER ? 'myridedrive' : 'myride',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  splash: { image: './assets/splash-icon.png', resizeMode: 'contain', backgroundColor: DRIVER ? '#075a52' : '#0b7a6f' },
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
      backgroundColor: DRIVER ? '#075a52' : '#0b7a6f',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', ...(DRIVER ? ['CAMERA', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION'] : [])],
  },
  web: { favicon: './assets/favicon.png', bundler: 'metro' },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-web-browser',
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
  },
});
