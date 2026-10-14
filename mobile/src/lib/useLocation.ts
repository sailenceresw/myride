import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { POKHARA } from './config';

export type Fix = { lat: number; lng: number; heading: number | null };

// navigation: turn-by-turn (≈1 s) · tracking: online driver reporting every ~3 s · normal: rider map.
const MODES = {
  navigation: { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 3 },
  tracking: { accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 10 },
  normal: { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 15 },
};

/** Foreground GPS; `onFix` runs inside the GPS callback. Falls back to central Pokhara if permission is denied. */
export function useLocation(mode: keyof typeof MODES = 'normal', onFix?: (f: Fix) => void, enabled = true) {
  const [fix, setFix] = useState<Fix | null>(null);
  const cb = useRef(onFix);
  useEffect(() => { cb.current = onFix; }, [onFix]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let sub: Location.LocationSubscription | null = null;
    const emit = (f: Fix) => { if (!cancelled) { setFix(f); cb.current?.(f); } };
    (async () => {
      if ((await Location.requestForegroundPermissionsAsync()).status !== 'granted') {
        return emit({ lat: POKHARA.latitude, lng: POKHARA.longitude, heading: null });
      }
      const s = await Location.watchPositionAsync(MODES[mode], ({ coords: c }) => emit({ lat: c.latitude, lng: c.longitude, heading: c.heading }));
      if (cancelled) s.remove(); else sub = s;
    })().catch(() => {});
    return () => { cancelled = true; sub?.remove(); };
  }, [mode, enabled]);

  return fix;
}
