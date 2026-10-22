import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppMap, type MapHandle, type MapMarker } from '@/components/AppMap';
import { MapPicker } from '@/components/MapPicker';
import { PlaceSearch, type Kind, type Place, type Shortcut } from '@/components/PlaceSearch';
import { QuoteRow } from '@/components/QuoteRow';
import { PayScreen, type PayInit } from '@/components/PayScreen';
import { ShareTrip } from '@/components/ShareTrip';
import { TripChat } from '@/components/TripChat';
import { TripPanel } from '@/components/TripPanel';
import { Button, Chip, Icon, RoundButton, Row, Sheet, Txt, type IconName } from '@/components/ui';
import { api, rs, type Point, type Quote, type Trip } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { call, POLICE } from '@/lib/config';
import { RADIUS, shadow, useTheme, vehicleEmoji } from '@/lib/theme';
import { useLocation } from '@/lib/useLocation';
import { useEvents } from '@/lib/useEvents';
import { usePolling } from '@/lib/usePolling';
import { useSavedPlaces, type SavedKey } from '@/lib/useSavedPlaces';
import { useTripChat } from '@/lib/useTripChat';

type QuoteResp = { route: { km: number; min: number; geometry: [number, number][] }; quotes: Quote[]; pickupWard: string | null; dropWard: string | null; recommend: string | null; promoError: string | null };

const ACTIVE = ['scheduled', 'searching', 'accepted', 'arrived', 'in_progress'];
const KINDS: Record<Kind, [string, IconName]> = { ride: ['Ride', 'car-sport'], delivery: ['Parcel', 'cube'], logistics: ['Logistics', 'bus'] };
const PAYMENTS: Record<'cash' | 'esewa' | 'khalti', [string, IconName]> = { cash: ['Cash', 'cash-outline'], esewa: ['eSewa', 'wallet-outline'], khalti: ['Khalti', 'card-outline'] };
const QUICK: Record<string, [string, IconName]> = {
  'pokhara-intl-airport': ['Airport', 'airplane-outline'], 'tourist-bus-park': ['Bus Park', 'bus-outline'], mahendrapul: ['Mahendrapul', 'storefront-outline'],
  lakeside: ['Lakeside', 'boat-outline'], 'prithvi-chowk': ['Prithvi Chowk', 'git-network-outline'], chipledhunga: ['Chipledhunga', 'cart-outline'],
};
const SAVED: Record<SavedKey, [string, IconName]> = { home: ['Home', 'home'], work: ['Work', 'briefcase'] };
const SEARCH_TITLE = { pickup: 'Pickup point', drop: 'Where to?', stop: 'Add a stop', home: 'Set your Home', work: 'Set your Work' };
const MAX_STOPS = 2; // like Uber; the server checks it too
type Field = 'pickup' | 'drop' | 'stop' | SavedKey;
const short = (s?: string) => (s ?? 'Drop').replace(/ \(.*\)$/, '').slice(0, 24); // "Talchowk (Lekhnath)" → "Talchowk"
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const asPoint = (p: Place): Point => ({ lat: p.lat, lng: p.lng, label: p.name });
const km = (a: Point, b: Point) => { // haversine
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const clock = (ms: number) => {
  const d = new Date(ms), today = new Date().toDateString() === d.toDateString();
  return `${today ? 'Today' : 'Tomorrow'} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
};
/** Schedule choices (the server takes 15 minutes to 7 days ahead), rounded up to the next 5 minutes. */
const scheduleOptions = () => {
  const at = (mins: number) => Math.ceil((Date.now() + mins * 60000) / 300000) * 300000;
  const tomorrow = (h: number) => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(h, 0, 0, 0); return d.getTime(); };
  return [at(30), at(60), at(120), tomorrow(7), tomorrow(9)];
};

export default function CustomerHome() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { profile, refresh } = useAuth();
  const map = useRef<MapHandle>(null);
  const fix = useLocation('normal');

  const [kind, setKind] = useState<Kind>('ride');
  const [pickupChoice, setPickup] = useState<Point | null>(null);
  const [drop, setDrop] = useState<Point | null>(null);
  const [searching, setSearching] = useState<null | Field>(null);
  const [picking, setPicking] = useState<null | Field>(null); // "set on map"
  const [stops, setStops] = useState<Point[]>([]); // rides: stops on the way, in order
  const [stopEdit, setStopEdit] = useState<number | null>(null); // which stop the search / map picker is for (null = a new one)
  const [hereAddr, setHereAddr] = useState<{ label: string; at: Point } | null>(null);
  const { places: saved, save } = useSavedPlaces();
  const [promo, setPromo] = useState(''); // typed code
  const [promoApplied, setPromoApplied] = useState<string | null>(null);
  const [promoOpen, setPromoOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [note, setNote] = useState(''); // for the rider: "blue gate opposite the school"
  const [noteOpen, setNoteOpen] = useState(false);
  const [places, setPlaces] = useState<Place[]>([]);
  const [placesFailed, setPlacesFailed] = useState(false);
  const [quote, setQuote] = useState<QuoteResp | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [payment, setPayment] = useState<keyof typeof PAYMENTS>('cash');
  const [weight, setWeight] = useState('2');
  const [receiver, setReceiver] = useState({ name: '', phone: '' });
  const [trip, setTrip] = useState<Trip | null>(null);
  const [recent, setRecent] = useState<Point[]>([]);
  const [city, setCity] = useState<{ centre: Point; maxRadiusKm: number } | null>(null);
  const [when, setWhen] = useState<number | null>(null); // scheduled pickup time; null = now
  const [whenOpen, setWhenOpen] = useState(false);
  const [nearby, setNearby] = useState<{ key?: string; lat: number; lng: number; type: string; heading?: number | null }[]>([]);
  const [approach, setApproach] = useState<Point[] | null>(null); // the rider's road route to the pickup
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sheetH, setSheetH] = useState(300);

  // Outside Pokhara (e.g. a phone abroad), GPS can't be the pickup: the server only accepts pickups in the city.
  const outside = !!fix && !!city && km(fix, city.centre) > city.maxRadiusKm;
  // Default pickup = the user's current location (until they pick another place).
  const here = useMemo(() => (fix && !outside ? { lat: fix.lat, lng: fix.lng, label: hereAddr?.label ?? 'Current location' } : null), [fix, outside, hereAddr]);
  const pickup = pickupChoice ?? here;

  // Name the GPS position ("Near Hallan Chowk") instead of "Current location"; look it up again after moving 60 m.
  useEffect(() => {
    if (!fix || outside || (hereAddr && km(hereAddr.at, fix) < 0.06)) return;
    const at = { lat: fix.lat, lng: fix.lng };
    api<{ label: string }>('GET', `/api/places/reverse?lat=${at.lat}&lng=${at.lng}`).then((a) => setHereAddr({ label: a.label, at })).catch(() => {});
  }, [fix, outside, hereAddr]);

  // Start the map on the user's current location (first GPS fix), or on Pokhara when they're outside it.
  const centred = useRef(false);
  useEffect(() => {
    if (!fix || !city || centred.current) return;
    centred.current = true;
    if (drop || trip) return; // a route is already framed (Book again, a trip in progress): don't pull the map away
    map.current?.flyTo(outside ? city.centre : fix, { zoom: outside ? 13 : 16 });
  }, [fix, city, outside, drop, trip]);

  // Places (landmarks, 33 wards, intercity lanes), the city, any trip still in progress and recent destinations.
  const loadPlaces = useCallback(() => {
    Promise.all([api<Place[]>('GET', '/api/places'), api<{ city: { centre: Point; maxRadiusKm: number }; logistics: { destinations: Place[] } }>('GET', '/api/config')])
      .then(([p, c]) => { setPlaces([...p, ...c.logistics.destinations.map((d) => ({ ...d, category: 'intercity' }))]); setCity(c.city); setPlacesFailed(false); })
      .catch(() => setPlacesFailed(true));
  }, []);
  const loadTrips = useCallback(() => {
    api<Trip[]>('GET', '/api/trips').then((l) => {
      // A trip in progress, or else a finished eSewa/Khalti ride still to pay (last 7 days), like Uber's outstanding balance.
      const unpaid = l.find((x) => x.status === 'completed' && x.payment.method !== 'cash' && x.payment.status !== 'paid' && x.fare > 0 && Date.now() - x.createdAt < 7 * 86400000);
      setTrip(l.find((x) => ACTIVE.includes(x.status)) ?? unpaid ?? null);
      const seen = new Set<string>();
      setRecent(l.filter((x) => x.status === 'completed' && x.drop.label && !seen.has(x.drop.label) && seen.add(x.drop.label)).slice(0, 3).map((x) => x.drop));
    }).catch(() => {});
  }, []);
  useEffect(() => { loadPlaces(); loadTrips(); }, [loadPlaces, loadTrips]);

  // Links from other screens: "Set Home / Work" (Account) opens that search; "Book again" (Your trips) below.
  const params = useLocalSearchParams<{ rebook?: string; set?: string }>();
  const linkSet: SavedKey | null = params.set === 'home' || params.set === 'work' ? params.set : null;
  const searchMode = searching ?? linkSet;
  const endLink = () => { if (linkSet) router.setParams({ set: undefined }); };

  // Live trip updates arrive over SSE; the slow poll only covers a dropped connection.
  const live = !!trip && ACTIVE.includes(trip.status);
  const update = (next: Trip) => {
    if (next.status !== trip?.status) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setTrip(next);
  };
  // Chat with the rider once one has accepted (messages stay readable after the trip).
  const chat = useTripChat(trip?.driver ? trip.id : null, 'rider');
  const chatOpen = !!trip && ['accepted', 'arrived', 'in_progress'].includes(trip.status);
  // Server events say role 'rider' for the customer (legacy server naming, see mobile/AGENTS.md).
  useEvents((e) => { if (!chat.receive(e) && e.type === 'trip' && e.role === 'rider' && e.trip.id === trip?.id) update(e.trip); }, live);
  usePolling(async () => { update(await api<Trip>('GET', `/api/trips/${trip!.id}`)); if (trip?.driver) await chat.refresh(); }, 15000, live);

  // Vehicles around the pickup (or around Pokhara's centre while the user is outside the city).
  const around = pickup ?? (outside ? city!.centre : null);
  usePolling(async () => setNearby(await api('GET', `/api/nearby?lat=${around!.lat}&lng=${around!.lng}`)), 8000, !trip && !!around);

  const getQuote = useCallback(async (p: Point, d: Point, k: Kind, promoCode: string | null = promoApplied, via: Point[] = stops) => {
    setErr(''); setBusy(true);
    try {
      const r = await api<QuoteResp>('POST', '/api/quote', { pickup: p, drop: d, kind: k, stops: k === 'ride' && via.length ? via : undefined, promoCode: promoCode ?? undefined, parcel: k === 'ride' ? undefined : { weightKg: +weight || 1 } });
      setQuote(r);
      setSel(r.recommend ?? r.quotes.find((q) => !q.unavailable)?.service ?? null);
      if (r.promoError) { setErr(r.promoError); setPromoApplied(null); }
    } catch (e) { setErr((e as Error).message); setQuote(null); }
    setBusy(false);
  }, [weight, promoApplied, stops]);

  // "Book again": the same pickup, destination and kind of trip, freshly quoted. Each link is handled once
  // (remembered, not cleared: navigating while the app is still starting from the link would crash the router).
  const rebooked = useRef<string | null>(null);
  useEffect(() => {
    const id = params.rebook;
    if (!id || rebooked.current === id) return;
    rebooked.current = id;
    api<Trip>('GET', `/api/trips/${id}`).then((old) => {
      const k: Kind = old.logistics ? 'logistics' : old.kind === 'delivery' ? 'delivery' : 'ride';
      setPickup(old.pickup); setDrop(old.drop); setKind(k); setStops(old.stops ?? []);
      getQuote(old.pickup, old.drop, k, null, old.stops ?? []);
    }).catch((e) => setErr((e as Error).message));
  }, [params.rebook, getQuote]);

  const geometry = trip?.route.geometry ?? quote?.route.geometry;
  const routeCoords = useMemo(() => geometry?.map(([lat, lng]) => ({ lat, lng })), [geometry]);
  // While the rider comes to you, frame the rider and the pickup (re-framed every ~100 m), like Uber.
  const coming = !!trip && ['accepted', 'arrived'].includes(trip.status) && !!trip.driver?.loc;
  const driverCell = coming ? `${trip!.driver!.loc!.lat.toFixed(3)},${trip!.driver!.loc!.lng.toFixed(3)}` : null;
  // The rider's road route to you, like Uber's approach line: fetched again each time they move ~100 m.
  useEffect(() => {
    if (!coming || !trip?.driver?.loc) return;
    const from = trip.driver.loc, to = trip.pickup;
    api<{ geometry: [number, number][] }>('GET', `/api/navigate?from=${from.lat},${from.lng}&to=${to.lat},${to.lng}`)
      .then((r) => setApproach(r.geometry.map(([lat, lng]) => ({ lat, lng }))))
      .catch(() => setApproach([from, to]));
  }, [driverCell]); // eslint-disable-line react-hooks/exhaustive-deps -- driverCell stands for the rider's position
  // Otherwise keep the whole route visible above the sheet, whatever its height.
  useEffect(() => {
    // Room for the pin labels (they stand ~70 px above their pins and can be ~200 px wide) and the top buttons.
    const pad = { top: insets.top + 150, right: 80, bottom: sheetH + 30, left: 80 };
    if (coming && trip) map.current?.fit([trip.driver!.loc!, trip.pickup], pad);
    else if (routeCoords) map.current?.fit(routeCoords, pad);
  }, [routeCoords, sheetH, insets.top, driverCell]); // eslint-disable-line react-hooks/exhaustive-deps -- driverCell stands for the rider's position

  const quick = useMemo(() => places.filter((p) => p.id in QUICK), [places]);

  function choose(p: Point | null, field = searchMode) { // null = back to current location
    if (field === 'home' || field === 'work') { if (p) save(field, { ...p, label: p.label && p.label !== 'Current location' ? p.label : SAVED[field][0] }); setSearching(null); endLink(); return; }
    if (field === 'stop') {
      setSearching(null); setStopEdit(null);
      if (!p) return;
      const next = stopEdit !== null && stopEdit < stops.length ? stops.map((s, i) => (i === stopEdit ? p : s)) : [...stops, p].slice(0, MAX_STOPS);
      setStops(next);
      if (pickup && drop) getQuote(pickup, drop, kind, promoApplied, next);
      return;
    }
    const nextPickup = field === 'pickup' ? p ?? here : pickup;
    const nextDrop = field === 'drop' ? p : drop;
    if (field === 'pickup') setPickup(p); else setDrop(p);
    setSearching(null);
    if (nextPickup && nextDrop) getQuote(nextPickup, nextDrop, kind);
  }
  function chooseKind(k: Kind) {
    setKind(k);
    if (k !== 'ride') setStops([]); // stops are for rides
    if (pickup && drop) getQuote(pickup, drop, k, promoApplied, k === 'ride' ? stops : []);
  }
  const editStop = (i: number | null) => { setStopEdit(i); setSearching('stop'); };
  const removeStop = (i: number) => {
    const next = stops.filter((_, j) => j !== i);
    setStops(next);
    if (pickup && drop) getQuote(pickup, drop, kind, promoApplied, next);
  };
  const clearDrop = () => { setDrop(null); setStops([]); setQuote(null); setErr(''); if (fix) map.current?.flyTo(fix, { zoom: 16 }); };
  const closeSearch = () => { setSearching(null); endLink(); };

  async function book() {
    if (!pickup || !drop || !sel) return;
    setErr(''); setBusy(true);
    try {
      const goods = kind === 'ride' ? {} : { parcel: { weightKg: +weight || 1 }, recipient: receiver };
      const scheduledAt = when ? new Date(when).toISOString() : undefined;
      const via = kind === 'ride' && stops.length ? stops : undefined;
      setTrip(await api<Trip>('POST', '/api/trips', { service: sel, pickup, drop, stops: via, payment, promoCode: promoApplied ?? undefined, scheduledAt, note: note.trim() || undefined, ...goods }));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      setQuote(null); setWhen(null); setWhenOpen(false); setNote(''); setNoteOpen(false); setStops([]);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  const tripAction = async (path: string, body: object) => {
    setErr('');
    try { setTrip(await api<Trip>('POST', `/api/trips/${trip!.id}/${path}`, body)); } catch (e) { setErr((e as Error).message); }
  };
  // Uber asks before cancelling: a stray tap must not cancel a ride (and may cost a fee once the rider has waited).
  const confirmCancel = () => Alert.alert(
    'Cancel this trip?',
    trip?.status === 'arrived' ? 'Your rider is waiting at the pickup. A cancellation fee may apply.' : trip?.driver ? `${trip.driver.name.split(' ')[0]} is already on the way.` : 'We are still finding you a rider.',
    [{ text: 'Keep trip', style: 'cancel' }, { text: 'Cancel trip', style: 'destructive', onPress: () => tripAction('cancel', { reason: 'rider_cancelled' }) }],
  );
  const rate = async (stars: number, comment: string) => {
    setErr('');
    try { await api('POST', `/api/trips/${trip!.id}/rate`, { stars, comment }); setTrip({ ...trip!, riderRating: { stars } }); } catch (e) { setErr(`Rating not saved: ${(e as Error).message}`); }
  };
  const sos = () => { api('POST', `/api/trips/${trip!.id}/sos`, { loc: fix }).catch(() => {}); call(POLICE); }; // always call the police, even if MyRide is unreachable
  const reset = () => { setTrip(null); setDrop(null); setStops([]); setQuote(null); setPromoApplied(null); setErr(''); refresh(); loadTrips(); };
  const applyPromo = () => { const code = promo.trim().toUpperCase(); if (!code || !pickup || !drop) return; setPromoApplied(code); setPromoOpen(false); getQuote(pickup, drop, kind, code); };

  const selected = quote?.quotes.find((q) => q.service === sel);
  const pk = trip?.pickup ?? pickup, dp = trip?.drop ?? drop;
  const vias = trip ? trip.stops ?? [] : stops;
  const markers: MapMarker[] = [
    // Nearby vehicles only before a destination is chosen: on the fare screen they would hide the route.
    ...(trip || drop ? [] : nearby.map((c, i) => ({ key: `n${c.key ?? i}`, at: c, kind: 'vehicle' as const, vehicle: c.type, heading: c.heading, emoji: vehicleEmoji(c.type), size: 20 }))),
    ...(pk && (drop || trip) ? [{ key: 'pickup', at: pk, kind: 'pickup' as const, label: trip?.status === 'arrived' ? 'Your rider is here' : short(pk.label === 'Current location' ? 'Pickup' : pk.label) }] : []),
    ...vias.map((s, i) => ({ key: `stop${i}`, at: s, kind: 'stop' as const, badge: String(i + 1) })), // numbered pin, no label: keeps the route visible
    ...(dp ? [{ key: 'drop', at: dp, kind: 'drop' as const, label: short(dp.label), eta: quote && !trip ? `${Math.round(quote.route.min)} min` : undefined }] : []),
    ...(trip?.driver?.loc ? [{ key: 'driver', at: trip.driver.loc, kind: 'vehicle' as const, vehicle: trip.driver.vehicle.type, heading: trip.driver.heading, emoji: vehicleEmoji(trip.driver.vehicle.type), size: 22 }] : []),
  ];
  const input = [styles.small, { borderColor: t.line, color: t.ink, backgroundColor: t.bg }];

  // ---------- set on map ----------
  if (picking) {
    const current = picking === 'pickup' ? pickup : picking === 'drop' ? drop : picking === 'stop' ? (stopEdit !== null ? stops[stopEdit] : drop) : saved[picking];
    const start = current ?? here ?? city?.centre ?? { lat: 28.2096, lng: 83.9856 };
    const confirm = picking === 'pickup' ? 'Confirm pickup' : picking === 'drop' ? 'Confirm destination' : picking === 'stop' ? 'Add this stop' : `Save as ${SAVED[picking][0]}`;
    return <MapPicker title={SEARCH_TITLE[picking]} start={start} user={fix} inCityOnly={picking === 'pickup'} confirmLabel={confirm} onConfirm={(p) => { const f = picking; setPicking(null); choose(p, f); }} onClose={() => setPicking(null)} />;
  }

  // ---------- search screen ----------
  if (searchMode) {
    const shortcuts: Shortcut[] =
      searchMode === 'pickup' ? (here ? [{ key: 'here', icon: 'locate', title: 'Use current location', subtitle: 'GPS', onPress: () => choose(null) }] : [])
        : searchMode === 'drop' || searchMode === 'stop' ? [
          ...(Object.keys(SAVED) as SavedKey[]).flatMap((k): Shortcut[] => (saved[k] ? [{ key: k, icon: SAVED[k][1], title: SAVED[k][0], subtitle: 'Saved place', onPress: () => choose(saved[k]!) }] : [])),
          ...recent.map((p): Shortcut => ({ key: `r${p.label}`, icon: 'time-outline', title: p.label!, subtitle: 'Recent', onPress: () => choose(p) })),
        ]
          : here ? [{ key: 'here', icon: 'locate', title: 'Use my current location', subtitle: `Save as ${SAVED[searchMode][0]}`, onPress: () => choose(here) }] : [];
    return (
      <PlaceSearch
        title={SEARCH_TITLE[searchMode]} places={places} kind={kind} near={pickup ?? (outside ? city?.centre ?? null : here)} shortcuts={shortcuts}
        onPick={(p) => choose(asPoint(p))} onMap={() => { setPicking(searchMode); setSearching(null); endLink(); }}
        onClose={() => { closeSearch(); setStopEdit(null); }} failed={placesFailed} onRetry={loadPlaces}
      />
    );
  }

  const schedulePicker = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 6 }}>
      <Chip label="Now" icon="flash-outline" active={!when} onPress={() => { setWhen(null); setWhenOpen(false); }} />
      {scheduleOptions().map((ms) => <Chip key={ms} label={clock(ms)} active={when === ms} onPress={() => { setWhen(ms); setWhenOpen(false); }} />)}
    </ScrollView>
  );
  const first = profile?.name?.split(' ')[0];
  return (
    <View style={{ flex: 1 }}>
      <AppMap ref={map} user={fix} padding={{ bottom: sheetH }} markers={markers}
        lines={coming && approach ? [{ coords: approach, color: t.ink, width: 5 }] : routeCoords ? [{ coords: routeCoords, color: t.ink, width: 5 }] : []} />

      <View style={[styles.top, { top: insets.top + 8 }]}>
        <View>
          <RoundButton icon="person" label="Account" onPress={() => router.push('/customer/account')} />
          {profile?.membership.active && <View style={[styles.plus, { backgroundColor: t.accent, borderColor: t.card }]}><Icon name="star" size={10} color="#fff" /></View>}
        </View>
        {!trip && !drop && (
          <View style={[styles.hello, shadow(5), { backgroundColor: t.card }]}>
            <Text style={{ color: t.muted, fontSize: 12 }}>{greeting()}</Text>
            <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15 }} numberOfLines={1}>{first ? `${first}, where to?` : 'Where to?'}</Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        {!trip && <RoundButton icon="receipt-outline" label="Your trips" onPress={() => router.push('/customer/activity')} />}
      </View>

      {!trip && fix && <RoundButton icon="locate" label="Recenter on my location" onPress={() => map.current?.flyTo(fix, { zoom: 16 })} style={{ position: 'absolute', right: 14, bottom: sheetH + 14 }} />}

      <Sheet
        onHeight={setSheetH}
        maxHeight={drop && !trip ? '56%' : undefined} // choosing a ride: leave the map room for the whole route (the list scrolls)
        footer={!trip && selected ? (
          <>
            {promoOpen && (
              <Row>
                <TextInput autoFocus value={promo} onChangeText={(v) => setPromo(v.toUpperCase())} placeholder="Promo code, e.g. POKHARA20" placeholderTextColor={t.muted} autoCapitalize="characters" onSubmitEditing={applyPromo} style={[...input, { flex: 1 }]} />
                <Button title="Apply" kind="soft" onPress={applyPromo} style={{ minHeight: 44, paddingVertical: 10 }} />
              </Row>
            )}
            {whenOpen && schedulePicker}
            {noteOpen && (
              <TextInput autoFocus value={note} onChangeText={setNote} maxLength={140} placeholder="Note for your rider, e.g. blue gate opposite the school" placeholderTextColor={t.muted} onSubmitEditing={() => setNoteOpen(false)} returnKeyType="done" style={input} />
            )}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              <Chip label={when ? clock(when) : 'Now'} icon="time-outline" active={!!when} onPress={() => setWhenOpen(!whenOpen)} />
              {(Object.keys(PAYMENTS) as (keyof typeof PAYMENTS)[]).map((p) => <Chip key={p} label={PAYMENTS[p][0]} icon={PAYMENTS[p][1]} active={payment === p} onPress={() => setPayment(p)} />)}
              <Chip label={note.trim() ? 'Note added' : 'Note'} icon={note.trim() ? 'checkmark-circle' : 'chatbox-ellipses-outline'} active={!!note.trim()} onPress={() => setNoteOpen(!noteOpen)} />
              <Chip label={promoApplied ?? 'Promo'} icon={promoApplied ? 'checkmark-circle' : 'pricetag-outline'} active={!!promoApplied} onPress={() => setPromoOpen(!promoOpen)} />
            </ScrollView>
            <Button title={`${when ? 'Schedule' : 'Book'} ${selected.label.replace('MyRide ', '')} · ${selected.total === 0 ? 'FREE' : rs(selected.total)}`} onPress={book} loading={busy} kind="dark" />
          </>
        ) : undefined}
      >
        {trip ? (
          <TripPanel trip={trip} err={err} unread={chat.unread} onMessage={chat.open} onShare={() => setShareOpen(true)} onPay={() => setPayOpen(true)} onCancel={confirmCancel} onRate={rate} onSos={sos} onDone={reset} />
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Row style={{ marginBottom: 12 }}>
              {(Object.keys(KINDS) as Kind[]).map((k) => <Chip key={k} label={KINDS[k][0]} icon={KINDS[k][1]} active={kind === k} onPress={() => chooseKind(k)} />)}
            </Row>

            {outside && !pickupChoice && (
              <View style={[styles.banner, { backgroundColor: t.accentSoft }]}>
                <Icon name="location-outline" size={18} color={t.accent} />
                <Txt kind="small" style={{ flex: 1, color: t.ink }}>{"You're outside Pokhara. MyRide works in Pokhara for now: choose a pickup point there to book."}</Txt>
              </View>
            )}
            {profile?.firstRideFree && !outside && (
              <View style={[styles.banner, { backgroundColor: t.okSoft }]}>
                <Icon name="gift" size={18} color={t.ok} />
                <Txt kind="small" style={{ flex: 1, color: t.ink }}>Your first ride is free (up to Rs 100)</Txt>
              </View>
            )}
            {!drop ? (
              <>
                <View style={[styles.whereTo, { backgroundColor: t.chip }]}>
                  <Pressable onPress={() => setSearching('drop')} style={styles.whereToTap} accessibilityRole="search">
                    <Icon name="search" size={22} />
                    <Text style={{ flex: 1, fontSize: 19, fontWeight: '800', color: t.ink }}>Where to?</Text>
                  </Pressable>
                  <Pressable onPress={() => setWhenOpen(!whenOpen)} style={[styles.now, { backgroundColor: t.card }]} accessibilityLabel="Pickup time">
                    <Icon name="time-outline" size={15} /><Text style={{ fontWeight: '700', color: t.ink, fontSize: 13 }}>{when ? clock(when) : 'Now'}</Text><Icon name="chevron-down" size={13} color={t.muted} />
                  </Pressable>
                </View>
                {whenOpen && schedulePicker}
                <Pressable onPress={() => setSearching('pickup')} style={styles.from}>
                  <View style={[styles.dot, { backgroundColor: t.ink }]} />
                  <Txt kind="muted" numberOfLines={1} style={{ flex: 1 }}>Pickup: <Text style={{ color: t.ink, fontWeight: '700' }}>{pickup?.label ?? (outside ? 'Choose a pickup in Pokhara' : 'Locating you…')}</Text></Txt>
                  <Icon name="pencil" size={15} color={t.muted} />
                </Pressable>
                {recent.slice(0, 2).map((p) => (
                  <Pressable key={p.label} onPress={() => choose(p, 'drop')} style={[styles.recent, { borderColor: t.line }]}>
                    <View style={[styles.recentIcon, { backgroundColor: t.chip }]}><Icon name="time-outline" size={18} /></View>
                    <View style={{ flex: 1 }}><Txt style={{ fontWeight: '700' }} numberOfLines={1}>{p.label}</Txt><Txt kind="small">Recent</Txt></View>
                    <Icon name="chevron-forward" size={18} color={t.muted} />
                  </Pressable>
                ))}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                  {(Object.keys(SAVED) as SavedKey[]).map((k) => <Chip key={k} label={saved[k] ? SAVED[k][0] : `Set ${SAVED[k][0]}`} icon={SAVED[k][1]} active={false} onPress={() => (saved[k] ? choose(saved[k]!, 'drop') : setSearching(k))} onLongPress={() => setSearching(k)} />)}
                  {quick.map((p) => <Chip key={p.id} label={QUICK[p.id][0]} icon={QUICK[p.id][1]} onPress={() => choose(asPoint(p), 'drop')} />)}
                </ScrollView>
                <Pressable onPress={() => router.push('/customer/fares')} style={[styles.from, { marginTop: 4 }]}>
                  <Icon name="shield-checkmark" size={16} color={t.ok} />
                  <Txt kind="small" style={{ flex: 1 }}>Fixed fares under the legal maximum. No surge pricing, ever.</Txt>
                  <Text style={{ color: t.brand, fontWeight: '700', fontSize: 12 }}>See fares</Text>
                </Pressable>
              </>
            ) : (
              <>
                {/* Pickup, stops on the way (rides, up to 2) and destination: tap one to change it. */}
                <View style={[styles.route, { backgroundColor: t.chip }]}>
                  <RouteRow marker={<View style={[styles.dot, { backgroundColor: t.ink }]} />} label={pickup?.label ?? 'Locating you…'} onPress={() => setSearching('pickup')} />
                  {stops.map((s, i) => (
                    <RouteRow key={`${i}${s.label}`} marker={<View style={[styles.stopMark, { borderColor: t.ink }]}><Text style={{ fontSize: 9, fontWeight: '900', color: t.ink }}>{i + 1}</Text></View>}
                      label={s.label ?? `Stop ${i + 1}`} onPress={() => editStop(i)}
                      action={<Pressable onPress={() => removeStop(i)} hitSlop={10} accessibilityLabel={`Remove stop ${i + 1}`}><Icon name="close-circle" size={20} color={t.muted} /></Pressable>} />
                  ))}
                  <RouteRow marker={<View style={[styles.dot, { backgroundColor: t.ink, borderRadius: 2 }]} />} label={drop.label ?? 'Destination'} bold onPress={() => setSearching('drop')}
                    action={<Pressable onPress={clearDrop} hitSlop={10} accessibilityLabel="Clear route"><Icon name="close" size={22} color={t.muted} /></Pressable>} />
                  {kind === 'ride' && stops.length < MAX_STOPS && (
                    <Pressable onPress={() => editStop(null)} style={styles.addStop} accessibilityRole="button">
                      <Icon name="add-circle-outline" size={18} color={t.brand} /><Text style={{ color: t.brand, fontWeight: '700' }}>Add stop</Text>
                    </Pressable>
                  )}
                </View>
                {!!quote && (
                  <Txt kind="small" style={{ marginVertical: 6 }} numberOfLines={2}>
                    {quote.route.km.toFixed(1)} km · {Math.round(quote.route.min)} min
                    {stops.length
                      ? ` · ${stops.length} stop${stops.length > 1 ? 's' : ''}, waiting over 3 min at a stop is charged`
                      : quote.pickupWard === quote.dropWard ? (quote.pickupWard ? ` · within ${quote.pickupWard}` : '') : `${quote.pickupWard ? ` · ${quote.pickupWard}` : ''}${quote.dropWard ? ` → ${quote.dropWard}` : ''}`}
                  </Txt>
                )}

                {kind !== 'ride' && (
                  <View style={{ gap: 8, marginVertical: 6 }}>
                    <Row>
                      <TextInput value={weight} onChangeText={setWeight} onEndEditing={() => pickup && getQuote(pickup, drop, kind)} keyboardType="decimal-pad" placeholder="kg" placeholderTextColor={t.muted} style={[...input, { width: 76 }]} />
                      <Txt kind="small">kg</Txt>
                      <TextInput value={receiver.name} onChangeText={(name) => setReceiver({ ...receiver, name })} placeholder="Receiver name" placeholderTextColor={t.muted} style={[...input, { flex: 1 }]} />
                    </Row>
                    <TextInput value={receiver.phone} onChangeText={(phone) => setReceiver({ ...receiver, phone: phone.replace(/\D/g, '').slice(0, 10) })} keyboardType="phone-pad" placeholder="Receiver mobile 98XXXXXXXX" placeholderTextColor={t.muted} style={input} />
                  </View>
                )}

                {busy && !quote && <Txt kind="muted" style={{ marginVertical: 12 }}>Finding the best fares…</Txt>}
                {quote?.quotes.map((q) => <QuoteRow key={q.service} q={q} selected={q.service === sel} recommended={quote.recommend === q.service} scheduled={!!when} onPress={() => !q.unavailable && setSel(q.service)} />)}
              </>
            )}
            {!!err && <Row style={{ marginVertical: 6 }}><Icon name="alert-circle" size={18} color={t.danger} /><Text style={{ color: t.danger, flex: 1 }}>{err}</Text></Row>}
          </ScrollView>
        )}
      </Sheet>

      {trip && trip.payment.method !== 'cash' && (
        <PayScreen
          visible={payOpen} title={`Pay ${rs(trip.fare)}`} onClose={() => setPayOpen(false)}
          start={() => api<PayInit>('POST', `/api/trips/${trip.id}/pay`)}
          onResult={async (r) => {
            if (r === 'cancelled') return;
            if (r !== 'paid') { setErr(r === 'amount_mismatch' ? 'The amount paid did not match the fare. Contact support.' : 'Payment did not go through. Try again.'); return; }
            setErr('');
            setTrip(await api<Trip>('GET', `/api/trips/${trip.id}`).catch(() => ({ ...trip, payment: { ...trip.payment, status: 'paid' } })));
          }}
        />
      )}
      {trip && live && (
        <ShareTrip
          visible={shareOpen} onClose={() => setShareOpen(false)} trip={trip} saved={profile?.closeContacts ?? []}
          onShared={(sharedWith) => { setTrip({ ...trip, sharedWith }); refresh(); }}
        />
      )}
      {trip?.driver && (
        <TripChat
          visible={chat.visible} onClose={chat.close} tripId={trip.id} me="rider" open={chatOpen}
          name={trip.driver.name} subtitle={`${trip.driver.vehicle.model} · ${trip.driver.vehicle.plate}`}
          messages={chat.messages} onSent={chat.sent}
          quickReplies={trip.status === 'in_progress' ? ['Please slow down', 'Stop here, please', 'Thank you!'] : ["I'm at the pickup", "I'll be there in 2 min", 'Where are you?', 'Please wait a moment', 'Okay 👍']}
        />
      )}
    </View>
  );
}

/** One point of the route card: marker, place (tap to change) and an optional action on the right. */
function RouteRow({ marker, label, bold, onPress, action }: { marker: React.ReactNode; label: string; bold?: boolean; onPress: () => void; action?: React.ReactNode }) {
  return (
    <Row style={{ gap: 12, minHeight: 34 }}>
      <View style={{ width: 16, alignItems: 'center' }}>{marker}</View>
      <Pressable onPress={onPress} style={{ flex: 1 }}><Txt numberOfLines={1} style={bold ? { fontWeight: '800' } : undefined}>{label}</Txt></Pressable>
      {action}
    </Row>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: 14, right: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  hello: { borderRadius: RADIUS.pill, paddingHorizontal: 16, paddingVertical: 7, maxWidth: '62%' },
  whereTo: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: RADIUS.md, paddingRight: 10 },
  whereToTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingVertical: 15 },
  now: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 7 },
  plus: { position: 'absolute', right: -2, top: -2, width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10 },
  recent: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  recentIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  from: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 4 },
  route: { borderRadius: RADIUS.md, paddingHorizontal: 14, paddingVertical: 8, gap: 2 },
  stopMark: { width: 14, height: 14, borderRadius: 3, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  addStop: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingLeft: 28 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  small: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
});
