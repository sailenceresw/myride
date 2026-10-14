import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Navigator } from '@/components/Navigator';
import { AppMap, type MapHandle } from '@/components/AppMap';
import { Button, Card, RoundButton, Row, Sheet, Txt } from '@/components/ui';
import { api, ApiError, rs, type DriverTrip } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { call } from '@/lib/config';
import { useTheme, vehicleEmoji } from '@/lib/theme';
import { useLocation } from '@/lib/useLocation';
import { useEvents } from '@/lib/useEvents';
import { usePolling } from '@/lib/usePolling';

type Driver = {
  online: boolean; driverType: 'partner' | 'employee'; rating: number; vehicle: { type: string; plate: string };
  earnings: { today: number; trips: number }; hoursLeftToday: number; suspended?: { reason: string } | null;
  faceCheck?: { pending?: boolean; requestedAt?: number }; homeFilter?: { ward: string | null } | null;
};
type Dashboard = { driver: Driver | null; application: { status: string } | null };
const ON_TRIP = ['accepted', 'arrived', 'in_progress'];
const buzz = (style = Haptics.ImpactFeedbackStyle.Medium) => Haptics.impactAsync(style).catch(() => {});

export default function DriverHome() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const map = useRef<MapHandle>(null);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [offers, setOffers] = useState<DriverTrip[]>([]);
  const [trip, setTrip] = useState<DriverTrip | null>(null);
  const [simulate, setSimulate] = useState(false);
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [codDone, setCodDone] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const d = dash?.driver ?? null;
  const navigating = !!trip && trip.status !== 'arrived'; // the Navigator runs its own GPS watcher
  const fix = useLocation(d?.online ? 'tracking' : 'normal', undefined, !navigating);
  const dropOffer = useCallback(() => setOffers((x) => x.slice(1)), []); // the first offer timed out
  const promptedCheck = useRef<number | undefined>(undefined);
  const lastSent = useRef(0);

  const load = useCallback(async () => {
    const r = await api<Dashboard>('GET', '/api/driver/dashboard').catch(() => null);
    if (!r) return;
    setDash(r);
    const fc = r.driver?.faceCheck;
    if (fc?.pending && promptedCheck.current !== fc.requestedAt) { promptedCheck.current = fc.requestedAt; router.push('/driver/selfie'); } // once per check
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    api<DriverTrip[]>('GET', '/api/trips').then((l) => setTrip(l.find((x) => ON_TRIP.includes(x.status)) ?? null)).catch(() => {});
  }, []);

  // Start the map on the driver's current location.
  const centred = useRef(false);
  useEffect(() => {
    if (!fix || centred.current || trip) return;
    centred.current = true;
    map.current?.flyTo(fix, { zoom: 15.5 });
  }, [fix, trip]);

  // Report GPS while online (every ≥ 3 s) so dispatch and the rider's live map are accurate.
  const report = useCallback((p: { lat: number; lng: number }) => {
    if (Date.now() - lastSent.current < 3000) return;
    lastSent.current = Date.now();
    api('POST', '/api/driver/location', p).catch(() => {});
  }, []);
  useEffect(() => { if (d?.online && fix && !trip) report(fix); }, [fix, d?.online, trip, report]);

  // While online: offers and trip changes arrive live over SSE; a slow poll covers dropped connections.
  const showOffers = (o: DriverTrip[]) => {
    if (o.length && !offers.length) { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); Speech.speak('New trip request'); }
    setOffers(o);
  };
  const tripChanged = (next: DriverTrip) => {
    const still = ON_TRIP.includes(next.status);
    setTrip(still ? next : null);
    if (!still) load();
  };
  useEvents((e) => {
    if (e.type === 'offer' && !trip) showOffers([e.trip, ...offers.filter((x) => x.id !== e.trip.id)]);
    else if (e.type === 'trip' && e.role === 'driver' && e.trip.id === trip?.id) tripChanged(e.trip);
    else if (e.type === 'face_check') load(); // load() opens the selfie screen
  }, !!d?.online);
  usePolling(async () => {
    if (trip) tripChanged(await api<DriverTrip>('GET', `/api/trips/${trip.id}`));
    else showOffers(await api<DriverTrip[]>('GET', '/api/driver/offers'));
  }, 10000, !!d?.online);

  /** Busy/error handling for every driver action; a 428 means "selfie check first". */
  async function run(fn: () => Promise<unknown>) {
    setErr(''); setBusy(true);
    try { await fn(); } catch (e) {
      if (e instanceof ApiError && e.status === 428) router.push('/driver/selfie'); else setErr((e as Error).message);
    }
    setBusy(false);
  }

  const toggleOnline = () => run(async () => {
    await api('POST', '/api/driver/online', { online: !d?.online, loc: fix ?? undefined });
    buzz(Haptics.ImpactFeedbackStyle.Heavy);
    await load();
  });

  const act = (path: string, body: object = {}) => run(async () => {
    const next = await api<DriverTrip>('POST', `/api/trips/${trip!.id}/${path}`, body);
    buzz();
    if (ON_TRIP.includes(next.status)) return setTrip(next);
    setTrip(null); setPin(''); setCode(''); setCodDone(false); load();
  });

  const accept = (o: DriverTrip) => run(async () => {
    try { setTrip(await api<DriverTrip>('POST', `/api/trips/${o.id}/accept`)); } catch (e) { setOffers((x) => x.filter((y) => y.id !== o.id)); throw e; }
    setOffers([]);
    Speech.speak(`Trip accepted. Navigate to ${o.pickup.label}`);
  });

  const headingHome = () => run(async () => {
    if (!d?.homeFilter && !fix) return;
    await api('POST', '/api/driver/heading-home', { loc: d?.homeFilter ? null : fix });
    load();
  });

  // ---------- not yet approved ----------
  if (dash && !d) {
    const submitted = dash.application?.status === 'submitted';
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, padding: 22, paddingTop: insets.top + 30, gap: 12 }}>
        <Txt kind="h1">Welcome to MyRide Drive</Txt>
        <Txt kind="muted">{submitted ? 'Your application is being reviewed (usually within 48 hours). We will SMS you when you are approved.' : 'Finish your application: documents, bank account and a live selfie. Takes about 10 minutes.'}</Txt>
        {!submitted && <Button title={dash.application ? 'Continue application' : 'Start application'} onPress={() => router.push('/driver/apply')} />}
        <Button title="Check status" kind="ghost" onPress={load} />
        <Button title="Sign out" kind="ghost" onPress={signOut} />
      </View>
    );
  }

  // ---------- on a trip: Uber-style navigation ----------
  if (trip && navigating) {
    const toPickup = trip.status === 'accepted';
    const dest = toPickup ? trip.pickup : trip.drop;
    const delivering = !toPickup && trip.kind === 'delivery';
    return (
      <Navigator
        key={`${trip.id}-${trip.status}`}
        destination={dest}
        destinationLabel={dest.label ?? (toPickup ? 'Pickup' : 'Drop')}
        simulate={simulate}
        vehicleIcon={vehicleEmoji(d?.vehicle.type)}
        onPosition={report}
        onArrive={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); if (toPickup) Speech.speak('You have arrived at the pickup. Tap arrived.'); }}
        bottom={
          <View style={{ gap: 8 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Txt style={{ fontWeight: '800' }}>{toPickup ? `Pick up ${trip.riderName}` : delivering ? `Deliver to ${trip.recipient?.name ?? 'receiver'}` : `Drop ${trip.riderName}`}</Txt>
                <Txt kind="small">{rs(trip.fare)} · {trip.payment}{trip.parcel ? ` · ${trip.parcel.weightKg} kg${trip.parcel.codAmount ? ` · collect COD ${rs(trip.parcel.codAmount)}` : ''}` : ''}</Txt>
              </View>
              <RoundButton icon="📞" label="Call" onPress={() => call(delivering ? trip.recipient?.phone : trip.riderPhone)} style={{ backgroundColor: t.bg }} />
            </Row>
            {delivering && (
              <Row>
                <TextInput value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" placeholder="Receiver code" placeholderTextColor={t.muted} style={[styles.input, { borderColor: t.line, color: t.ink, flex: 1 }]} />
                {!!trip.parcel?.codAmount && <Row><Switch value={codDone} onValueChange={setCodDone} /><Txt kind="small">COD collected</Txt></Row>}
              </Row>
            )}
            {!!err && <Text style={{ color: t.danger }}>{err}</Text>}
            {toPickup
              ? <Button title="Arrived at pickup" onPress={() => act('arrived')} loading={busy} />
              : <Button title={delivering ? 'Confirm delivery' : 'Complete trip'} kind="dark" onPress={() => act('complete', { deliveryOtp: code, codCollected: codDone })} loading={busy} />}
            <Row style={{ justifyContent: 'space-between' }}>
              <Row><Switch value={simulate} onValueChange={setSimulate} /><Txt kind="small">Demo: simulate driving</Txt></Row>
              {toPickup && <Pressable onPress={() => act('cancel', { reason: 'driver_cancelled' })}><Text style={{ color: t.danger }}>Cancel</Text></Pressable>}
            </Row>
          </View>
        }
      />
    );
  }

  // ---------- home: map + GO button + offers / PIN entry ----------
  return (
    <View style={{ flex: 1 }}>
      <AppMap ref={map} user={fix} traffic padding={{ bottom: 260 }} markers={trip ? [{ key: 'pickup', at: trip.pickup, color: t.brand, title: 'Pickup' }] : []} />

      <View style={[styles.earn, { top: insets.top + 8, backgroundColor: t.ink }]}>
        <Text style={{ color: t.bg, fontWeight: '800', fontSize: 18 }}>{d?.driverType === 'employee' ? `${d.earnings.trips} trips` : rs(d?.earnings.today ?? 0)}</Text>
        <Text style={{ color: t.bg, opacity: 0.7, fontSize: 11 }}>{d?.driverType === 'employee' ? 'MyRide fleet' : 'today'}</Text>
      </View>
      <RoundButton icon="💰" label="Earnings and payouts" onPress={() => router.push('/driver/earnings')} style={[styles.corner, { top: insets.top + 8, right: 14 }]} />
      <RoundButton icon="⎋" label="Sign out" onPress={signOut} style={[styles.corner, { top: insets.top + 8, left: 14 }]} />

      {!d?.online && !trip && (
        <Pressable onPress={toggleOnline} disabled={busy || !!d?.suspended} style={[styles.go, { backgroundColor: t.brand, bottom: 210 + insets.bottom }]} accessibilityLabel="Go online">
          <Text style={styles.goText}>GO</Text>
        </Pressable>
      )}

      <Sheet>
        <ScrollView>
          {trip ? (
            <>
              <Txt kind="h2">Waiting for {trip.riderName}</Txt>
              <Txt kind="muted">Ask for their 4-digit MyRide PIN to start the trip.</Txt>
              <TextInput value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" placeholder="••••" placeholderTextColor={t.muted} maxLength={4} style={[styles.pinInput, { borderColor: t.line, color: t.ink }]} />
              {!!err && <Text style={{ color: t.danger }}>{err}</Text>}
              <Button title="Start trip" onPress={() => act('start', { pin })} loading={busy} disabled={pin.length !== 4} />
              {trip.riderPhone && <Button title={`Call ${trip.riderName}`} kind="ghost" onPress={() => call(trip.riderPhone)} style={{ marginTop: 6 }} />}
            </>
          ) : offers[0] ? (
            <OfferCard key={offers[0].id} o={offers[0]} onAccept={() => accept(offers[0])} onExpire={dropOffer} />
          ) : (
            <>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt kind="h2">{d?.suspended ? 'Account paused' : d?.online ? "You're online" : "You're offline"}</Txt>
                {d?.online && <Pressable onPress={toggleOnline}><Text style={{ color: t.danger, fontWeight: '700' }}>Go offline</Text></Pressable>}
              </Row>
              <Txt kind="muted">{d?.suspended ? d.suspended.reason : d?.online ? 'Finding trips near you…' : 'Tap GO to start receiving trips.'}</Txt>
              <Row style={{ marginTop: 8, justifyContent: 'space-between' }}>
                <Txt kind="small">{vehicleEmoji(d?.vehicle.type)} {d?.vehicle.plate} · ★ {d?.rating}</Txt>
                <Txt kind="small">{Math.max(0, d?.hoursLeftToday ?? 12).toFixed(1)} h left today</Txt>
              </Row>
              {d?.online && <Button title={d.homeFilter ? `🏠 Heading home${d.homeFilter.ward ? ` (${d.homeFilter.ward})` : ''} — stop` : '🏠 Heading home'} kind="ghost" onPress={headingHome} style={{ marginTop: 8 }} />}
              {!!err && <Text style={{ color: t.danger, marginTop: 6 }}>{err}</Text>}
            </>
          )}
        </ScrollView>
      </Sheet>
    </View>
  );
}

function OfferCard({ o, onAccept, onExpire }: { o: DriverTrip; onAccept: () => void; onExpire: () => void }) {
  const t = useTheme();
  const left = useCallback(() => Math.max(0, Math.round((o.offerExpiresAt - Date.now()) / 1000)), [o.offerExpiresAt]);
  const [secs, setSecs] = useState(left);
  useEffect(() => { const id = setInterval(() => setSecs(left()), 1000); return () => clearInterval(id); }, [left]);
  useEffect(() => { if (secs === 0) onExpire(); }, [secs, onExpire]);
  return (
    <Card style={{ borderColor: t.accent, borderWidth: 2 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt style={{ fontWeight: '800' }}>{o.logistics ? '🚚 Logistics' : o.kind === 'delivery' ? '📦 Parcel' : '🧍 Ride'}</Txt>
        <View style={[styles.timer, { borderColor: secs <= 5 ? t.danger : t.accent }]}><Text style={{ color: t.ink, fontWeight: '800' }}>{secs}</Text></View>
      </Row>
      <Text style={{ fontSize: 30, fontWeight: '900', color: t.ok, marginVertical: 4 }}>{rs(o.employee ? o.fare : (o.earning ?? 0) + o.deadKmBonus)}</Text>
      <Txt kind="small">{o.employee ? 'Company fare (you are on wages)' : `You earn${o.deadKmBonus ? ` · incl. ${rs(o.deadKmBonus)} long-pickup bonus` : ''}`}</Txt>
      <Txt style={{ marginTop: 6 }}>📍 {o.pickup.label} <Text style={{ color: t.muted }}>· {o.pickupKm} km away</Text></Txt>
      <Txt>🏁 {o.drop.label} <Text style={{ color: t.muted }}>· {o.km.toFixed(1)} km trip</Text></Txt>
      {o.parcel && <Txt kind="small">{o.parcel.goodsType ?? 'parcel'} · {o.parcel.weightKg} kg{o.parcel.codAmount ? ` · collect COD ${rs(o.parcel.codAmount)}` : ''}</Txt>}
      <Txt kind="small">Payment: {o.payment}</Txt>
      <Button title="Accept" onPress={onAccept} style={{ marginTop: 10 }} />
    </Card>
  );
}

const styles = StyleSheet.create({
  earn: { position: 'absolute', alignSelf: 'center', paddingHorizontal: 18, paddingVertical: 8, borderRadius: 99, alignItems: 'center', elevation: 8 },
  corner: { position: 'absolute' },
  go: { position: 'absolute', alignSelf: 'center', width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', elevation: 12, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10, borderWidth: 4, borderColor: '#fff' },
  goText: { color: '#fff', fontSize: 28, fontWeight: '900' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  pinInput: { borderWidth: 2, borderRadius: 12, fontSize: 32, letterSpacing: 14, textAlign: 'center', fontWeight: '900', paddingVertical: 10, marginVertical: 10 },
  timer: { width: 40, height: 40, borderRadius: 20, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
});
