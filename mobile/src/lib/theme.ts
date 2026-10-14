import { useColorScheme } from 'react-native';

const light = {
  brand: '#0b7a6f', accent: '#f29e1f', danger: '#d6342c', ok: '#1f9d55',
  ink: '#17201f', muted: '#5d6b69', line: '#dfe6e4', bg: '#f4f7f6', card: '#ffffff', navBanner: '#0b7a6f',
};
const dark: typeof light = { ...light, ink: '#e8efee', muted: '#9db0ad', line: '#2b3735', bg: '#0f1615', card: '#172120', navBanner: '#075a52' };

export type Theme = typeof light;
export const useTheme = (): Theme => (useColorScheme() === 'dark' ? dark : light);

// One icon table for vehicle types and the services that use them.
const ICONS: Record<string, string> = {
  bike: '🏍️', bike_ev: '🛵', car: '🚗', car_ev: '🚙', jeep: '🚙', van: '🚐', pickup: '🛻',
  cargo: '🚚', truck_light: '🚚', truck: '🚛', parcel_express: '📦', parcel_standard: '📮',
};
export const vehicleEmoji = (type?: string) => ICONS[type ?? ''] ?? '🏍️';
