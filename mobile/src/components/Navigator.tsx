import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { BaseTiles, tileMapType } from './BaseTiles';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
type Active = { route: NavRoute; cum: number[]; offsets: number[]; startedAt: number; hint: number };
type View3 = NavState & { segIndex: number; pos: { lat: number; lng: number }; etaClock: string };

/** Uber-style turn-by-turn navigation: maneuver banner, tilted camera following heading, voice, rerouting. */
export function Navigator({ destination, destinationLabel, simulate = false, vehicleIcon = '🏍️', onPosition, onArrive, bottom }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const map = useRef<MapView>(null);
  const [route, setRoute] = useState<NavRoute | null>(null);
  const [nav, setNav] = useState<View3 | null>(null);
  const [muted, setMuted] = useState(false);
  const [follow, setFollow] = useState(true);
  const [rerouting, setRerouting] = useState(false);

  // Mutable navigation session (read/written only in GPS callbacks and effects).
  const active = useRef<Active | null>(null);
  const fetching = useRef(false);
  const spoken = useRef(new Set<string>());
  const offCount = useRef(0);
  const lastReroute = useRef(0);
  const arrivedFired = useRef(false);
  const opts = useRef({ muted, follow, onPosition, onArrive });
  useEffect(() => { opts.current = { muted, follow, onPosition, onArrive }; }, [muted, follow, onPosition, onArrive]);

  const fetchRoute = useCallback((from: { lat: number; lng: number }) => {
    if (fetching.current) return;
    fetching.current = true;
    setRerouting(true);
    api<NavRoute>('GET', `/api/navigate?from=${from.lat},${from.lng}&to=${destination.lat},${destination.lng}`)
      .then((r) => {
        const cum = cumulative(r.geometry);
        active.current = { route: r, cum, offsets: stepOffsets(r, cum), startedAt: Date.now(), hint: 0 };
        spoken.current = new Set();
        setRoute(r);
      })
      .catch(() => { /* keep the previous route; retried on the next off-route fix */ })
      .finally(() => { fetching.current = false; setRerouting(false); });
  }, [destination.lat, destination.lng]);

  // Called for every position (real GPS or simulated): progress, camera, voice, off-route, arrival.
  const onFix = useCallback((p: { lat: number; lng: number; heading: number | null }) => {
    const a = active.current;
    if (!a) { fetchRoute(p); return; }
    const s = progress(a.route, p, { cum: a.cum, offsets: a.offsets, hintIndex: a.hint });
    a.hint = s.segIndex; // keep searching forward: no snapping back on hairpins / out-and-back roads
    const o = opts.current;
    setNav({ ...s, pos: p, etaClock: new Date(Date.now() + s.remainingMin * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
    o.onPosition?.(p);
    const heading = p.heading != null && p.heading >= 0 ? p.heading : s.heading;
    if (o.follow) {
      const c = s.offRoute ? p : s.snapped;
      map.current?.animateCamera({ center: { latitude: c.lat, longitude: c.lng }, heading, pitch: 55, zoom: 17.5, altitude: 380 }, { duration: 900 });
    }
    if (!o.muted) {
      const say = announcement(s, spoken.current);
      if (say) { Speech.stop(); Speech.speak(say, { language: 'en-IN', rate: 1.0 }); }
    }
    offCount.current = s.offRoute ? offCount.current + 1 : 0;
    if (offCount.current >= 3 && Date.now() - lastReroute.current > 10000) {
      lastReroute.current = Date.now();
      offCount.current = 0;
      if (!o.muted) Speech.speak('Rerouting', { language: 'en-IN' });
      fetchRoute(p);
    }
    if (s.arrived && !arrivedFired.current) { arrivedFired.current = true; o.onArrive?.(); }
  }, [fetchRoute]);

  // Real GPS drives navigation unless the emulator demo is simulating.
  const onGps = useCallback((f: Fix) => { if (!simulate) onFix({ lat: f.lat, lng: f.lng, heading: f.heading }); }, [simulate, onFix]);
  const { fix } = useLocation('navigation', onGps);

  // Simulated drive along the current route at ~40 km/h (emulator demos).
  useEffect(() => {
    if (!simulate) return;
    const id = setInterval(() => {
      const a = active.current;
      if (!a) { if (fix) fetchRoute(fix); return; }
      const s = simulatedPosition(a.route, a.cum, (Date.now() - a.startedAt) / 1000, 11);
      onFix(s);
    }, 1000);
    return () => clearInterval(id);
  }, [simulate, fix, fetchRoute, onFix]);

  useEffect(() => () => { Speech.stop(); }, []);

  const remaining = route ? route.geometry.slice(Math.max(0, nav?.segIndex ?? 0)) : [];
  const marker = nav ? (nav.offRoute ? nav.pos : nav.snapped) : null;
  const openGoogle = () => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lng}&travelmode=driving`);

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        ref={map}
        mapType={tileMapType}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: fix?.lat ?? destination.lat, longitude: fix?.lng ?? destination.lng, latitudeDelta: 0.03, longitudeDelta: 0.03 }}
        showsCompass={false}
        showsTraffic
        pitchEnabled
        rotateEnabled
        onPanDrag={() => setFollow(false)}
        mapPadding={{ top: 150, bottom: 220, left: 0, right: 0 }}
      >
        <BaseTiles />
        {remaining.length > 1 && (
          <Polyline coordinates={remaining.map(([latitude, longitude]) => ({ latitude, longitude }))} strokeColor="#1a73e8" strokeWidth={8} lineCap="round" lineJoin="round" />
        )}
        <Marker coordinate={{ latitude: destination.lat, longitude: destination.lng }} title={destinationLabel} pinColor={t.accent} />
        {marker && (
          <Marker coordinate={{ latitude: marker.lat, longitude: marker.lng }} anchor={{ x: 0.5, y: 0.5 }} flat>
            <Text style={{ fontSize: 30 }}>{vehicleIcon}</Text>
          </Marker>
        )}
      </MapView>

      {/* Maneuver banner */}
      <View style={[styles.banner, { top: insets.top + 8, backgroundColor: t.navBanner }]}>
        {nav?.next ? (
          <>
            <Text style={styles.arrow}>{arrow(nav.next)}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.dist}>{nav.next.type === 'arrive' ? formatDistance(nav.remainingM) : formatDistance(nav.toNextM)}</Text>
              <Text style={styles.instr} numberOfLines={2}>{instruction(nav.next)}</Text>
            </View>
          </>
        ) : (
          <Text style={styles.instr}>{rerouting || !route ? 'Finding the best route…' : `Head to ${destinationLabel}`}</Text>
        )}
      </View>
      {rerouting && route && <View style={[styles.reroute, { top: insets.top + 100 }]}><Text style={{ color: '#fff', fontWeight: '700' }}>Rerouting…</Text></View>}

      {/* Map controls */}
      <View style={[styles.controls, { top: insets.top + 120 }]}>
        <Pressable accessibilityLabel={muted ? 'Unmute voice' : 'Mute voice'} onPress={() => { setMuted(!muted); Speech.stop(); }} style={[styles.round, { backgroundColor: t.card }]}><Text style={{ fontSize: 20 }}>{muted ? '🔇' : '🔊'}</Text></Pressable>
        {!follow && <Pressable accessibilityLabel="Recenter" onPress={() => setFollow(true)} style={[styles.round, { backgroundColor: t.card }]}><Text style={{ fontSize: 20 }}>🎯</Text></Pressable>}
        <Pressable accessibilityLabel="Open in Google Maps" onPress={openGoogle} style={[styles.round, { backgroundColor: t.card }]}><Text style={{ fontSize: 18 }}>🗺️</Text></Pressable>
      </View>

      {/* Trip strip + caller-provided actions */}
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
  round: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 14, elevation: 16, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 14 },
  etaRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: 2 },
  eta: { fontSize: 24, fontWeight: '800' },
});
