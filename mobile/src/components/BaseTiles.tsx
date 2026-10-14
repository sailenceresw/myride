import { UrlTile } from 'react-native-maps';

// Store builds use Google/Apple base maps (set GOOGLE_MAPS_ANDROID_KEY). In development without a key
// (e.g. Expo Go on an emulator, where Google returns "Authorization failure"), draw free CARTO tiles instead.
const NO_GOOGLE_KEY = !process.env.EXPO_PUBLIC_HAS_MAPS_KEY;

export const tileMapType = NO_GOOGLE_KEY ? ('none' as const) : ('standard' as const);

export function BaseTiles() {
  if (!NO_GOOGLE_KEY) return null;
  return <UrlTile urlTemplate="https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png" maximumZ={19} shouldReplaceMapContent tileSize={256} />;
}
