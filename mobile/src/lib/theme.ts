import { useColorScheme } from 'react-native';
import { IS_DRIVE } from './config';

const light = {
  brand: '#0b7a6f', brandDark: '#075a52', brandSoft: '#e2f3f0', accent: '#f29e1f', accentSoft: '#fff2dc',
  danger: '#d6342c', dangerSoft: '#fdecea', ok: '#1f9d55', okSoft: '#e5f5eb',
  ink: '#101a19', muted: '#5f6d6b', line: '#e3e9e7', bg: '#f3f6f5', card: '#ffffff', chip: '#edf2f1', navBanner: '#0b7a6f',
};
const dark: typeof light = {
  ...light, brandSoft: '#123430', accentSoft: '#3b2b10', dangerSoft: '#3d1715', okSoft: '#11301f',
  ink: '#e9f0ef', muted: '#9fb1ae', line: '#2a3634', bg: '#0d1413', card: '#162020', chip: '#1e2a29', navBanner: '#075a52',
};

export type Theme = typeof light;
export const useTheme = (): Theme => (useColorScheme() === 'dark' ? dark : light);

/** Brand gradient: teal for MyRide, near-black for MyRide Drive (like Uber vs Uber Driver). */
export const DRIVER_GRADIENT: [string, string] = ['#1f2e2c', '#070b0b']; // MyRide Drive colours, also used for "Become a rider" in MyRide
export const GRADIENT: [string, string] = IS_DRIVE ? DRIVER_GRADIENT : ['#119a8a', '#065249'];
export const RADIUS = { sm: 10, md: 14, lg: 20, pill: 999 };
export const shadow = (e = 6) => ({ shadowColor: '#0b1f1c', shadowOpacity: 0.14, shadowRadius: e * 1.6, shadowOffset: { width: 0, height: e / 2 }, elevation: e });

// One icon table for vehicle types and the services that use them.
const ICONS: Record<string, string> = {
  bike: '🏍️', bike_ev: '🛵', car: '🚗', car_ev: '🚙', jeep: '🚙', van: '🚐', pickup: '🛻',
  cargo: '🚚', truck_light: '🚚', truck: '🚛', parcel_express: '📦', parcel_standard: '📮',
};
export const vehicleEmoji = (type?: string) => ICONS[type ?? ''] ?? '🏍️';
