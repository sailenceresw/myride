import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Navigator } from '@/components/Navigator';
import { AppMap, type MapHandle } from '@/components/AppMap';
import { Avatar, Button, Card, Hero, Icon, ListRow, Pill, Pulse, RoundButton, Row, Sheet, Txt, type IconName } from '@/components/ui';
import { api, ApiError, rs, type DriverTrip } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { call } from '@/lib/config';
import { shadow, useTheme, vehicleEmoji } from '@/lib/theme';
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
  const [sheetH, setSheetH] = useState(260);
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
    if (e.type === 'offer' && !trip) showOffers([...offers.filter((x) => x.id !== e.trip.id), e.trip]); // queue behind the card on screen
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
    const steps: [IconName, string, string][] = [
      ['person-outline', 'Identity', 'Citizenship + driving licence'],
      ['car-outline', 'Vehicle', 'Bluebook, insurance, number plate'],
      ['business-outline', 'Bank account', 'For weekly payouts'],
      ['happy-outline', 'Live selfie', 'Matched to your ID photo'],
    ];
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <Hero style={{ paddingBottom: 40 }}>
          <Text style={styles.heroTitle}>Welcome to MyRide Drive</Text>
          <Text style={styles.heroSub}>{submitted ? "Your application is being reviewed (usually within 48 hours). We'll SMS you when you're approved." : 'Finish your application in about 10 minutes. Weekly payouts to your bank.'}</Text>
        </Hero>
        <View style={{ padding: 16, marginTop: -24, gap: 10 }}>
          <Card raised>{steps.map(([icon, title, subtitle]) => <ListRow key={title} icon={icon} title={title} subtitle={subtitle} right={submitted ? <Icon name="checkmark-circle" size={20} color={t.ok} /> : undefined} />)}</Card>
          {!submitted && <Button title={dash.application ? 'Continue application' : 'Start application'} icon="arrow-forward" onPress={() => router.push('/driver/apply')} />}
          <Button title="Check status" icon="refresh" kind="soft" onPress={load} />
          <Button title="Sign out" kind="ghost" onPress={signOut} />
        </View>
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
          <View style={{ gap: 10 }}>
            <Row style={{ gap: 12 }}>
              <Avatar name={delivering ? trip.recipient?.name ?? 'Receiver' : trip.riderName} size={44} />
              <View style={{ flex: 1 }}>
                <Txt style={{ fontWeight: '800' }}>{toPickup ? `Pick up ${trip.riderName}` : delivering ? `Deliver to ${trip.recipient?.name ?? 'receiver'}` : `Drop ${trip.riderName}`}</Txt>
                <Txt kind="small">{rs(trip.fare)} · {trip.payment}{trip.parcel ? ` · ${trip.parcel.weightKg} kg${trip.parcel.codAmount ? ` · collect COD ${rs(trip.parcel.codAmount)}` : ''}` : ''}</Txt>
              </View>
              <RoundButton icon="call" label="Call" color={t.brand} onPress={() => call(delivering ? trip.recipient?.phone : trip.riderPhone)} size={44} />
            </Row>
            {delivering && (
              <Row>
                <TextInput value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" placeholder="Receiver code" placeholderTextColor={t.muted} style={[styles.input, { borderColor: t.line, color: t.ink, flex: 1 }]} />
                {!!trip.parcel?.codAmount && <Row><Switch value={codDone} onValueChange={setCodDone} /><Txt kind="small">COD collected</Txt></Row>}
              </Row>
            )}
            {!!err && <Row><Icon name="alert-circle" size={18} color={t.danger} /><Text style={{ color: t.danger, flex: 1 }}>{err}</Text></Row>}
            {toPickup
              ? <Button title="Arrived at pickup" icon="flag" onPress={() => act('arrived')} loading={busy} />
              : <Button title={delivering ? 'Confirm delivery' : 'Complete trip'} icon="checkmark-done" kind="dark" onPress={() => act('complete', { deliveryOtp: code, codCollected: codDone })} loading={busy} />}
            <Row style={{ justifyContent: 'space-between' }}>
              <Row><Switch value={simulate} onValueChange={setSimulate} /><Txt kind="small">Demo: simulate driving</Txt></Row>
              {toPickup && <Pressable onPress={() => act('cancel', { reason: 'driver_cancelled' })} hitSlop={8}><Text style={{ color: t.danger, fontWeight: '700' }}>Cancel trip</Text></Pressable>}
            </Row>
          </View>
        }
      />
    );
  }

  // ---------- home: map + GO button + offers / PIN entry ----------
  const online = !!d?.online;
  return (
    <View style={{ flex: 1 }}>
      <AppMap ref={map} user={fix} traffic padding={{ bottom: sheetH }} markers={trip ? [{ key: 'pickup', at: trip.pickup, color: t.brand, title: 'Pickup' }] : []} />

      <View style={[styles.top, { top: insets.top + 8 }]}>
        <RoundButton icon="log-out-outline" label="Sign out" onPress={signOut} />
        <Pressable onPress={() => router.push('/driver/earnings')} style={[styles.earn, shadow(8), { backgroundColor: t.ink }]} accessibilityLabel="Earnings and payouts">
          <View style={[styles.status, { backgroundColor: online ? '#35d07f' : '#8a9997' }]} />
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: t.card, fontWeight: '900', fontSize: 19 }}>{d?.driverType === 'employee' ? `${d.earnings.trips} trips` : rs(d?.earnings.today ?? 0)}</Text>
            <Text style={{ color: t.card, opacity: 0.7, fontSize: 11, fontWeight: '600' }}>{d?.driverType === 'employee' ? 'MyRide fleet · today' : 'earned today'}</Text>
          </View>
        </Pressable>
        <RoundButton icon="wallet-outline" label="Earnings and payouts" onPress={() => router.push('/driver/earnings')} />
      </View>

      {!online && !trip && !d?.suspended && (
        <View style={[styles.goWrap, { bottom: sheetH + 24 }]}>
          <Pulse size={104} color={t.brand}>
            <Pressable onPress={toggleOnline} disabled={busy} style={({ pressed }) => [styles.go, shadow(12), { backgroundColor: t.brand, transform: [{ scale: pressed ? 0.95 : 1 }] }]} accessibilityLabel="Go online">
              <Text style={styles.goText}>GO</Text>
            </Pressable>
          </Pulse>
        </View>
      )}
      {fix && <RoundButton icon="locate" label="Recenter on my location" onPress={() => map.current?.flyTo(fix, { zoom: 15.5 })} style={{ position: 'absolute', right: 14, bottom: sheetH + 14 }} />}

      <Sheet onHeight={setSheetH}>
        <ScrollView showsVerticalScrollIndicator={false}>
          {trip ? (
            <>
              <Txt kind="h1">Waiting for {trip.riderName}</Txt>
              <Txt kind="muted">Ask for their 4-digit MyRide PIN to start the trip.</Txt>
              <PinBoxes value={pin} onChange={setPin} />
              {!!err && <Row style={{ marginBottom: 6 }}><Icon name="alert-circle" size={18} color={t.danger} /><Text style={{ color: t.danger, flex: 1 }}>{err}</Text></Row>}
              <Button title="Start trip" icon="play" onPress={() => act('start', { pin })} loading={busy} disabled={pin.length !== 4} />
              {trip.riderPhone && <Button title={`Call ${trip.riderName}`} icon="call-outline" kind="ghost" onPress={() => call(trip.riderPhone)} style={{ marginTop: 8 }} />}
            </>
          ) : offers[0] ? (
            <OfferCard key={offers[0].id} o={offers[0]} more={offers.length - 1} onAccept={() => accept(offers[0])} onExpire={dropOffer} />
          ) : (
            <>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Txt kind="h1">{d?.suspended ? 'Account paused' : online ? "You're online" : "You're offline"}</Txt>
                  <Txt kind="muted">{d?.suspended ? d.suspended.reason : online ? 'Finding trips near you…' : 'Tap GO to start receiving trips.'}</Txt>
                </View>
                {online && <Switch value onValueChange={toggleOnline} disabled={busy} trackColor={{ true: t.ok, false: t.line }} />}
              </Row>
              <Row style={{ marginTop: 12, gap: 10 }}>
                <Tile icon="speedometer-outline" value={`${Math.max(0, d?.hoursLeftToday ?? 12).toFixed(1)} h`} label="left today" />
                <Tile icon="star" value={String(d?.rating ?? '–')} label="rating" />
                <Tile emoji={vehicleEmoji(d?.vehicle.type)} value={d?.vehicle.plate ?? ''} label="vehicle" />
              </Row>
              {online && (
                <Button
                  title={d?.homeFilter ? `Heading home${d.homeFilter.ward ? ` · ${d.homeFilter.ward}` : ''} — stop` : 'Heading home'}
                  icon="home-outline"
                  kind={d?.homeFilter ? 'accent' : 'soft'}
                  onPress={headingHome}
                  style={{ marginTop: 12 }}
                />
              )}
              {!!err && <Row style={{ marginTop: 6 }}><Icon name="alert-circle" size={18} color={t.danger} /><Text style={{ color: t.danger, flex: 1 }}>{err}</Text></Row>}
            </>
          )}
        </ScrollView>
      </Sheet>
    </View>
  );
}

function Tile({ icon, emoji, value, label }: { icon?: IconName; emoji?: string; value: string; label: string }) {
  const t = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: t.chip }]}>
      {icon ? <Icon name={icon} size={18} color={t.brand} /> : <Text style={{ fontSize: 18 }}>{emoji}</Text>}
      <Text style={{ color: t.ink, fontWeight: '800', fontSize: 14, marginTop: 4 }} numberOfLines={1}>{value}</Text>
      <Txt kind="small">{label}</Txt>
    </View>
  );
}

/** Four PIN boxes over one transparent input. */
function PinBoxes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTheme();
  return (
    <View style={{ marginVertical: 14 }}>
      <Row style={{ justifyContent: 'center', gap: 12 }}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.pinBox, { borderColor: i === value.length ? t.brand : value[i] ? t.ink : t.line, backgroundColor: t.bg }]}>
            <Text style={{ fontSize: 30, fontWeight: '900', color: t.ink }}>{value[i] ?? ''}</Text>
          </View>
        ))}
      </Row>
      <TextInput value={value} onChangeText={(v) => onChange(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" maxLength={4} caretHidden style={[StyleSheet.absoluteFill, { opacity: 0.011 }]} accessibilityLabel="Customer PIN" />
    </View>
  );
}

const KIND_LABEL: Record<string, [IconName, string]> = { logistics: ['bus', 'Logistics'], delivery: ['cube', 'Parcel'], ride: ['person', 'Ride'] };

function OfferCard({ o, more, onAccept, onExpire }: { o: DriverTrip; more: number; onAccept: () => void; onExpire: () => void }) {
  const t = useTheme();
  const left = useCallback(() => Math.max(0, Math.round((o.offerExpiresAt - Date.now()) / 1000)), [o.offerExpiresAt]);
  const [secs, setSecs] = useState(left);
  const [total] = useState(() => Math.max(1, secs));
  useEffect(() => { const id = setInterval(() => setSecs(left()), 1000); return () => clearInterval(id); }, [left]);
  useEffect(() => { if (secs === 0) onExpire(); }, [secs, onExpire]);
  const [icon, label] = KIND_LABEL[o.logistics ? 'logistics' : o.kind] ?? KIND_LABEL.ride;
  const urgent = secs <= 5;
  return (
    <View>
      <View style={[styles.countdown, { backgroundColor: t.line }]}><View style={{ width: `${(secs / total) * 100}%`, height: '100%', borderRadius: 3, backgroundColor: urgent ? t.danger : t.accent }} /></View>
      <Row style={{ justifyContent: 'space-between', marginTop: 10 }}>
        <Pill icon={icon} text={label.toUpperCase()} color={t.brand} tint={t.brandSoft} />
        <Text style={{ color: urgent ? t.danger : t.muted, fontWeight: '800' }}>{secs}s{more > 0 ? ` · +${more} more` : ''}</Text>
      </Row>
      <Text style={{ fontSize: 38, fontWeight: '900', color: t.ok, marginTop: 6, letterSpacing: -0.5 }}>{rs(o.employee ? o.fare : (o.earning ?? 0) + o.deadKmBonus)}</Text>
      <Txt kind="small">{o.employee ? 'Company fare (you are on wages)' : `You earn${o.deadKmBonus ? ` · incl. ${rs(o.deadKmBonus)} long-pickup bonus` : ''}`} · {o.payment}</Txt>
      <View style={[styles.legs, { backgroundColor: t.chip }]}>
        <View style={{ alignItems: 'center', gap: 3, paddingTop: 5 }}>
          <View style={[styles.dot, { backgroundColor: t.brand }]} /><View style={{ width: 2, height: 22, backgroundColor: t.line }} /><View style={[styles.dot, { backgroundColor: t.accent, borderRadius: 2 }]} />
        </View>
        <View style={{ flex: 1, gap: 10 }}>
          <View><Txt style={{ fontWeight: '700' }} numberOfLines={1}>{o.pickup.label}</Txt><Txt kind="small">{o.pickupKm} km away</Txt></View>
          <View><Txt style={{ fontWeight: '700' }} numberOfLines={1}>{o.drop.label}</Txt><Txt kind="small">{o.km.toFixed(1)} km trip</Txt></View>
        </View>
      </View>
      {o.parcel && <Txt kind="small" style={{ marginBottom: 6 }}>{o.parcel.goodsType ?? 'Parcel'} · {o.parcel.weightKg} kg{o.parcel.codAmount ? ` · collect COD ${rs(o.parcel.codAmount)}` : ''}</Txt>}
      <Button title="Accept trip" icon="checkmark-circle" onPress={onAccept} />
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: 14, right: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  earn: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 99 },
  status: { width: 10, height: 10, borderRadius: 5 },
  goWrap: { position: 'absolute', alignSelf: 'center' },
  go: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: '#fff' },
  goText: { color: '#fff', fontSize: 30, fontWeight: '900', letterSpacing: 1 },
  heroTitle: { color: '#fff', fontSize: 28, fontWeight: '900', marginTop: 20 },
  heroSub: { color: '#ffffffc8', fontSize: 15, marginTop: 6, lineHeight: 21 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  tile: { flex: 1, borderRadius: 14, padding: 12 },
  pinBox: { width: 58, height: 66, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  countdown: { height: 6, borderRadius: 3, overflow: 'hidden' },
  legs: { flexDirection: 'row', gap: 12, borderRadius: 14, padding: 12, marginVertical: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
