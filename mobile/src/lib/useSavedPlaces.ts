import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import type { Point } from './api';

export type SavedKey = 'home' | 'work';
export type SavedPlaces = Partial<Record<SavedKey, Point>>;
const KEY = 'myride.savedPlaces';

const read = async (): Promise<string | null> => (Platform.OS === 'web' ? globalThis.localStorage?.getItem(KEY) ?? null : SecureStore.getItemAsync(KEY));
const write = async (v: string) => (Platform.OS === 'web' ? globalThis.localStorage?.setItem(KEY, v) : SecureStore.setItemAsync(KEY, v));

/** Home / Work shortcuts, kept on this phone only. */
export function useSavedPlaces() {
  const [places, setPlaces] = useState<SavedPlaces>({});
  useEffect(() => { read().then((v) => v && setPlaces(JSON.parse(v))).catch(() => {}); }, []);
  const save = useCallback((key: SavedKey, p: Point) => {
    setPlaces((old) => {
      const next = { ...old, [key]: p };
      write(JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);
  return { places, save };
}
