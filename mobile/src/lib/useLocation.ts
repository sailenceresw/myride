import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { POKHARA } from './config';

export type Fix = { lat: number; lng: number; heading: number | null; speed: number | null; accuracy: number | null; at: number };

/**
 * Foreground GPS. `mode: 'navigation'` = BestForNavigation every ~1 s / 3 m (driver on a trip);
 * `mode: 'normal'` = Balanced every ~5 s / 15 m. Falls back to central Pokhara if permission is denied.
 * `onFix` runs inside the GPS callback for each new position (use it for per-fix work like navigation).
 */
export function useLocation(mode: 'navigation' | 'normal' = 'normal', onFix?: (f: Fix) => void, enabled = true) {
  const [fix, setFix] = useState<Fix | null>(null);
  const [denied, setDenied] = useState(false);
  const cb = useRef(onFix);
  useEffect(() => { cb.current = onFix; }, [onFix]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let sub: Location.LocationSubscription | null = null;
    const emit = (f: Fix) => { if (!cancelled) { setFix(f); cb.current?.(f); } };
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setDenied(true);
        emit({ lat: POKHARA.latitude, lng: POKHARA.longitude, heading: null, speed: null, accuracy: null, at: Date.now() });
        return;
      }
      const opts = mode === 'navigation'
        ? { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 3 }
        : { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 15 };
      const s = await Location.watchPositionAsync(opts, (p) => {
        emit({ lat: p.coords.latitude, lng: p.coords.longitude, heading: p.coords.heading, speed: p.coords.speed, accuracy: p.coords.accuracy, at: p.timestamp });
      });
      if (cancelled) s.remove(); else sub = s;
    })().catch(() => setDenied(true));
    return () => { cancelled = true; sub?.remove(); };
  }, [mode, enabled]);

  return { fix, denied };
}
