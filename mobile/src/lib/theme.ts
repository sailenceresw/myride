import { useColorScheme } from 'react-native';

const light = {
  brand: '#0b7a6f', brandDark: '#075a52', accent: '#f29e1f', danger: '#d6342c', ok: '#1f9d55',
  ink: '#17201f', muted: '#5d6b69', line: '#dfe6e4', bg: '#f4f7f6', card: '#ffffff', navBanner: '#0b7a6f', onBrand: '#ffffff',
};
const dark: typeof light = {
  ...light, ink: '#e8efee', muted: '#9db0ad', line: '#2b3735', bg: '#0f1615', card: '#172120', navBanner: '#075a52',
};

export type Theme = typeof light;
export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export const vehicleEmoji = (type?: string) =>
  type === 'car' ? '🚗' : type === 'jeep' ? '🚙' : type === 'van' ? '🚐' : type && ['cargo', 'pickup', 'truck_light', 'truck'].includes(type) ? '🚚' : '🏍️';
