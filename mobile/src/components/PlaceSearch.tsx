import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackHeader, Button, Icon, Txt, type IconName } from '@/components/ui';
import { api, type Point } from '@/lib/api';
import { shadow, RADIUS, useTheme } from '@/lib/theme';

export type Kind = 'ride' | 'delivery' | 'logistics';
/** A place from /api/places (landmarks, wards) or /api/places/search (the whole OpenStreetMap gazetteer). */
export type Place = { id: string; name: string; lat: number; lng: number; category?: string; subtitle?: string; outside?: boolean; km?: number };
/** Highlighted rows above the results: "Use current location", Home, Work, recent… */
export type Shortcut = { key: string; icon: IconName; title: string; subtitle: string; onPress: () => void };

const PLACE_ICON: Record<string, IconName> = {
  ward: 'home-outline', area: 'location-outline', intercity: 'trail-sign-outline', transport: 'bus-outline', tourist: 'camera-outline',
  health: 'medkit-outline', hospital: 'medkit-outline', education: 'school-outline', food: 'restaurant-outline', bank: 'card-outline',
  worship: 'flower-outline', government: 'business-outline', shopping: 'bag-handle-outline', leisure: 'football-outline', hotel: 'bed-outline',
  fuel: 'speedometer-outline', building: 'business-outline', shop: 'storefront-outline', office: 'briefcase-outline', commercial: 'storefront-outline', residential: 'home-outline',
};

/**
 * Full-screen place picker (pickup, drop, Home/Work). It is a mode of the booking screen, not a route,
 * so its back arrow and Android's back button close it instead of leaving the app.
 * Typing searches every named place in Pokhara (Nepali or English, typos OK); "Set on map" drops a pin.
 */
export function PlaceSearch({ title, places, kind, near, shortcuts, onPick, onMap, onClose, failed, onRetry }: {
  title: string; places: Place[]; kind: Kind; near: Point | null; shortcuts: Shortcut[];
  onPick: (p: Place) => void; onMap: () => void; onClose: () => void; failed: boolean; onRetry: () => void;
}) {
  const t = useTheme();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Place[] | null>(null); // null = not searched yet
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [attempt, setAttempt] = useState(0); // bumped by "Try again"
  const seq = useRef(0);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [onClose]);

  // Search the gazetteer as the user types (debounced; only the latest request's answer is shown).
  const q = query.trim();
  useEffect(() => {
    if (!q) return;
    const id = ++seq.current;
    const timer = setTimeout(() => {
      setSearching(true);
      const at = near ? `&lat=${near.lat}&lng=${near.lng}` : '';
      api<Place[]>('GET', `/api/places/search?q=${encodeURIComponent(q)}${at}&limit=30`)
        .then((r) => { if (id === seq.current) { setHits(r); setSearchFailed(false); } })
        .catch(() => { if (id === seq.current) setSearchFailed(true); })
        .finally(() => { if (id === seq.current) setSearching(false); });
    }, 220);
    return () => clearTimeout(timer);
  }, [q, near, attempt]);

  // Empty box: the popular landmarks (and intercity lanes for logistics).
  const popular = useMemo(() => places.filter((p) => (kind === 'logistics' || p.category !== 'intercity') && p.category !== 'ward').slice(0, 40), [places, kind]);
  const intercity = useMemo(() => (kind === 'logistics' && q ? places.filter((p) => p.category === 'intercity' && p.name.toLowerCase().includes(q.toLowerCase())) : []), [places, kind, q]);
  const data = q ? [...intercity, ...(hits ?? [])] : popular;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ paddingHorizontal: 16, gap: 10 }}>
        <BackHeader title={title} onBack={onClose} />
        <View style={[styles.search, shadow(3), { backgroundColor: t.card }]}>
          <Icon name="search" size={20} color={t.muted} />
          <TextInput autoFocus value={query} onChangeText={setQuery} placeholder="Search any place, tole or street in Pokhara" placeholderTextColor={t.muted} style={{ flex: 1, fontSize: 16, color: t.ink, paddingVertical: 14 }} returnKeyType="search" />
          {searching ? <ActivityIndicator color={t.muted} /> : !!query && <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search"><Icon name="close-circle" size={20} color={t.muted} /></Pressable>}
        </View>
        <PlaceRow icon="map-outline" title="Set location on map" subtitle="Move the map to put the pin on the exact spot" onPress={onMap} highlight />
        {!q && shortcuts.map((s) => <PlaceRow key={s.key} icon={s.icon} title={s.title} subtitle={s.subtitle} onPress={s.onPress} highlight />)}
        {!q && !!popular.length && <Txt kind="label" style={{ marginTop: 6 }}>Popular places</Txt>}
      </View>
      <FlatList
        data={data}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        renderItem={({ item }) => (
          <PlaceRow
            icon={PLACE_ICON[item.category ?? ''] ?? 'location-outline'}
            title={item.name}
            subtitle={item.category === 'intercity' ? 'Intercity · logistics only' : item.subtitle ?? item.category}
            km={item.km}
            onPress={() => onPick(item)}
          />
        )}
        ListEmptyComponent={
          (q ? searchFailed : failed) ? (
            <View style={styles.empty}>
              <Icon name="cloud-offline-outline" size={44} color={t.muted} />
              <Txt kind="muted" style={{ textAlign: 'center' }}>{q ? "Couldn't search right now. Check your internet connection." : "Couldn't load places. Check your internet connection."}</Txt>
              <Button title="Try again" icon="refresh" kind="soft" onPress={q ? () => setAttempt((a) => a + 1) : onRetry} />
            </View>
          ) : q && hits && !searching ? (
            <View style={styles.empty}>
              <Txt kind="muted" style={{ textAlign: 'center' }}>No places match “{q}”. Try another spelling, or set the location on the map.</Txt>
              <Button title="Set location on map" icon="map-outline" kind="soft" onPress={onMap} />
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

function PlaceRow({ icon, title, subtitle, km, onPress, highlight }: { icon: IconName; title: string; subtitle?: string; km?: number; onPress: () => void; highlight?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.result, { borderColor: t.line, opacity: pressed ? 0.6 : 1 }]}>
      <View style={[styles.placeIcon, { backgroundColor: highlight ? t.ink : t.chip }]}><Icon name={icon} size={18} color={highlight ? t.card : t.ink} /></View>
      <View style={{ flex: 1 }}>
        <Txt style={{ fontWeight: '600' }} numberOfLines={1}>{title}</Txt>
        {!!subtitle && <Txt kind="small" numberOfLines={1}>{subtitle}</Txt>}
      </View>
      {km !== undefined && <Txt kind="small">{km < 1 ? `${Math.round(km * 1000)} m` : `${km} km`}</Txt>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: RADIUS.md, paddingHorizontal: 14 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  placeIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', gap: 10, marginTop: 40, paddingHorizontal: 24 },
});
