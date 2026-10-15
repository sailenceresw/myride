import * as Speech from 'expo-speech';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppMap, type MapHandle } from '@/components/AppMap';
import { RoundButton } from '@/components/ui';
import { api, type Point } from '@/lib/api';
import { announcement, arrow, cumulative, formatDistance, instruction, progress, simulatedPosition, stepOffsets, type NavRoute, type NavState } from '@/lib/nav';
import { useTheme } from '@/lib/theme';
import { useLocation, type Fix } from '@/lib/useLocation';

type Props = {
  destination: Point;
  destinationLabel: string;
  simulate?: boolean; // emulator demo: drive the route automatically
  vehicleIcon?: string;
  onPosition?: (p: { lat: number; lng: number }) => void; // report to the server for rider live tracking
  onArrive?: () => void;
  bottom?: ReactNode;
};
type Session = { route: NavRoute; cum: number[]; offsets: number[]; startedAt: number; hint: number };
type NavView = NavState & { pos: Fix; etaClock: string };

/** Uber-style turn-by-turn navigation: maneuver banner, tilted camera following heading, voice, rerouting. */
export function Navigator({ destination, destinationLabel, simulate = false, vehicleIcon = '🏍️', onPosition, onArrive, bottom }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const map = useRef<MapHandle>(null);
  const [route, setRoute] = useState<NavRoute | null>(null);
  const [nav, setNav] = useState<NavView | null>(null);
  const [muted, setMuted] = useState(false);
  const [follow, setFollow] = useState(true);
  const [rerouting, setRerouting] = useState(false);

  // Mutable navigation session — read/written only in GPS callbacks and effects.
  const session = useRef<Session | null>(null);
  const fetching = useRef(false);
  const spoken = useRef(new Set<string>());
  const offCount = useRef(0);
  const lastReroute = useRef(0);
  const arrivedFired = useRef(false);
  const lastFix = useRef<Fix | null>(null);
  const opts = useRef({ muted, follow, simulate, onPosition, onArrive });
  useEffect(() => { opts.current = { muted, follow, simulate, onPosition, onArrive }; }, [muted, follow, simulate, onPosition, onArrive]);

  const fetchRoute = useCallback((from: { lat: number; lng: number }) => {
    if (fetching.current) return;
    fetching.current = true;
    setRerouting(true);
    api<NavRoute>('GET', `/api/navigate?from=${from.lat},${from.lng}&to=${destination.lat},${destination.lng}`)
      .then((r) => {
        const cum = cumulative(r.geometry);
        session.current = { route: r, cum, offsets: stepOffsets(r, cum), startedAt: Date.now(), hint: 0 };
        spoken.current = new Set();
        setRoute(r);
      })
      .catch(() => { /* keep the previous route; retried on the next off-route fix */ })
      .finally(() => { fetching.current = false; setRerouting(false); });
  }, [destination.lat, destination.lng]);

  // Every position (real GPS or simulated): progress, camera, voice, off-route, arrival.
  const onFix = useCallback((p: Fix) => {
    const a = session.current;
    if (!a) return fetchRoute(p);
    const s = progress(a.route, p, { cum: a.cum, offsets: a.offsets, hintIndex: a.hint });
    a.hint = s.segIndex; // keep searching forward: no snapping back on hairpins / out-and-back roads
    const o = opts.current;
    setNav({ ...s, pos: p, etaClock: new Date(Date.now() + s.remainingMin * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
    o.onPosition?.(p);
    if (o.follow) {
      const c = s.offRoute ? p : s.snapped;
      map.current?.flyTo(c, { heading: p.heading != null && p.heading >= 0 ? p.heading : s.heading, pitch: 55, zoom: 17.5, duration: 900 });
    }
    const speak = (text: string) => { if (!o.muted) { Speech.stop(); Speech.speak(text, { language: 'en-IN' }); } };
    const say = announcement(s, spoken.current);
    if (say) speak(say);
    offCount.current = s.offRoute ? offCount.current + 1 : 0;
    if (offCount.current >= 3 && Date.now() - lastReroute.current > 10000) {
      lastReroute.current = Date.now();
      offCount.current = 0;
      speak('Rerouting');
      fetchRoute(p);
    }
    if (s.arrived && !arrivedFired.current) { arrivedFired.current = true; o.onArrive?.(); }
  }, [fetchRoute]);

  // Real GPS drives navigation unless the emulator demo is simulating.
  const onGps = useCallback((f: Fix) => { lastFix.current = f; if (!opts.current.simulate) onFix(f); }, [onFix]);
  useLocation('navigation', onGps);

  // Simulated drive along the current route at ~40 km/h (emulator demos).
  useEffect(() => {
    if (!simulate) return;
    const id = setInterval(() => {
      const a = session.current;
      if (a) onFix(simulatedPosition(a.route, a.cum, (Date.now() - a.startedAt) / 1000, 11));
      else if (lastFix.current) fetchRoute(lastFix.current);
    }, 1000);
    return () => clearInterval(id);
  }, [simulate, fetchRoute, onFix]);

  useEffect(() => () => { Speech.stop(); }, []);

  const coords = useMemo(() => route?.geometry.map(([lat, lng]) => ({ lat, lng })) ?? [], [route]);
  const segIndex = nav?.segIndex ?? 0;
  const remaining = useMemo(() => coords.slice(segIndex), [coords, segIndex]);
  const marker = nav && (nav.offRoute ? nav.pos : nav.snapped);

  return (
    <View style={StyleSheet.absoluteFill}>
      <AppMap
        ref={map}
        traffic
        onUserPan={() => setFollow(false)}
        padding={{ top: 150, bottom: 220 }}
        lines={[{ coords: remaining, color: '#1a73e8', width: 8 }]}
        markers={[
          { key: 'dest', at: destination, kind: 'drop', label: destinationLabel },
          ...(marker ? [{ key: 'me', at: marker, kind: 'vehicle' as const, emoji: vehicleIcon, size: 24 }] : []),
        ]}
      />

      {/* Maneuver banner */}
      <View style={[styles.banner, { top: insets.top + 8, backgroundColor: t.navBanner }]}>
        {nav?.next ? (
          <>
            <Text style={styles.arrow}>{arrow(nav.next)}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.dist}>{formatDistance(nav.next.type === 'arrive' ? nav.remainingM : nav.toNextM)}</Text>
              <Text style={styles.instr} numberOfLines={2}>{instruction(nav.next)}</Text>
            </View>
          </>
        ) : (
          <Text style={styles.instr}>{rerouting || !route ? 'Finding the best route…' : `Head to ${destinationLabel}`}</Text>
        )}
      </View>
      {rerouting && route && <View style={[styles.reroute, { top: insets.top + 100 }]}><Text style={{ color: '#fff', fontWeight: '700' }}>Rerouting…</Text></View>}

      <View style={[styles.controls, { top: insets.top + 120 }]}>
        <RoundButton icon={muted ? 'volume-mute' : 'volume-high'} label={muted ? 'Unmute voice' : 'Mute voice'} onPress={() => { setMuted(!muted); Speech.stop(); }} />
        {!follow && <RoundButton icon="navigate" label="Recenter" onPress={() => setFollow(true)} />}
        <RoundButton icon="map" label="Open in Google Maps" onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lng}&travelmode=driving`)} />
      </View>

      <View style={[styles.bottom, { backgroundColor: t.card, paddingBottom: Math.max(insets.bottom, 12) }]}>
        {nav && (
          <View style={styles.etaRow}>
            <Text style={[styles.eta, { color: t.ok }]}>{Math.max(1, Math.round(nav.remainingMin))} min</Text>
            <Text style={{ color: t.muted, fontSize: 15 }}>{formatDistance(nav.remainingM)} · arrive {nav.etaClock}</Text>
          </View>
        )}
        <Text style={{ color: t.muted, marginBottom: 8 }} numberOfLines={1}>To: {destinationLabel}</Text>
        {bottom}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { position: 'absolute', left: 10, right: 10, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, elevation: 8, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10 },
  arrow: { fontSize: 44, color: '#fff', width: 52, textAlign: 'center' },
  dist: { color: '#fff', fontSize: 26, fontWeight: '800' },
  instr: { color: '#fff', fontSize: 17, fontWeight: '600' },
  reroute: { position: 'absolute', alignSelf: 'center', backgroundColor: '#d6342c', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 99 },
  controls: { position: 'absolute', right: 12, gap: 10 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 14, elevation: 16, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 14 },
  etaRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: 2 },
  eta: { fontSize: 24, fontWeight: '800' },
});
