import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppMap, type MapHandle } from '@/components/AppMap';
import { Button, Icon, RoundButton, Row, Txt } from '@/components/ui';
import { api, type Point } from '@/lib/api';
import { shadow, useTheme } from '@/lib/theme';

type Address = { label: string; subtitle: string; lat: number; lng: number; ward: number | null };

/**
 * Uber-style "set on map": the pin stays in the middle, the user moves the map under it, and the address of the
 * spot appears below. `inCityOnly` (pickups) refuses spots outside Pokhara, which the server would reject.
 */
export function MapPicker({ title, start, user, inCityOnly, confirmLabel, onConfirm, onClose }: {
  title: string; start: Point; user: Point | null; inCityOnly: boolean; confirmLabel: string;
  onConfirm: (p: Point) => void; onClose: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const map = useRef<MapHandle>(null);
  const [addr, setAddr] = useState<Address | null>(null);
  const [moving, setMoving] = useState(false);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);

  useEffect(() => { map.current?.flyTo(start, { zoom: 17, duration: 0 }); }, [start]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [onClose]);

  const idle = (c: Point) => {
    setMoving(false);
    const id = ++seq.current;
    api<Address>('GET', `/api/places/reverse?lat=${c.lat}&lng=${c.lng}`)
      .then((a) => { if (id === seq.current) { setAddr(a); setFailed(false); } })
      .catch(() => { if (id === seq.current) { setAddr({ label: 'Dropped pin', subtitle: '', lat: c.lat, lng: c.lng, ward: null }); setFailed(true); } });
  };

  const outside = !!addr && !failed && inCityOnly && addr.ward === null;
  const ready = !!addr && !moving && !outside;
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ flex: 1 }}>
        <AppMap ref={map} user={user} onUserPan={() => setMoving(true)} onIdle={idle} />
        {/* The pin: lifts while the map moves, its tip marks the map's centre. */}
        <View pointerEvents="none" style={styles.pinWrap}>
          <View style={{ alignItems: 'center', transform: [{ translateY: moving ? -10 : 0 }] }}>
            <View style={[styles.pin, { backgroundColor: t.ink, borderColor: t.card }]}><View style={[styles.pinDot, { backgroundColor: t.card }]} /></View>
            <View style={[styles.stem, { backgroundColor: t.ink }]} />
          </View>
          <View style={[styles.shadowDot, { opacity: moving ? 0.25 : 0.5 }]} />
        </View>
        <RoundButton icon="arrow-back" label="Back" onPress={onClose} style={{ position: 'absolute', left: 14, top: insets.top + 8 }} />
        {user && <RoundButton icon="locate" label="Move pin to my location" onPress={() => map.current?.flyTo(user, { zoom: 17 })} style={{ position: 'absolute', right: 14, bottom: 14 }} />}
      </View>

      <View style={[styles.card, shadow(16), { backgroundColor: t.card, paddingBottom: Math.max(insets.bottom, 14) }]}>
        <Txt kind="label">{title}</Txt>
        <Row style={{ gap: 12, minHeight: 52 }}>
          <View style={[styles.icon, { backgroundColor: t.chip }]}><Icon name="location" size={20} /></View>
          {addr && !moving ? (
            <View style={{ flex: 1 }}>
              <Txt style={{ fontWeight: '800', fontSize: 17 }} numberOfLines={1}>{addr.label}</Txt>
              {!!addr.subtitle && <Txt kind="small" numberOfLines={1}>{addr.subtitle}</Txt>}
            </View>
          ) : (
            <Row style={{ flex: 1 }}><ActivityIndicator color={t.muted} /><Txt kind="muted">{moving ? 'Move the map to place the pin' : 'Finding the address…'}</Txt></Row>
          )}
        </Row>
        {outside && <Row><Icon name="alert-circle" size={16} color={t.danger} /><Txt kind="small" style={{ flex: 1, color: t.danger }}>Pickups are only inside Pokhara Metropolitan City. Move the pin into the city.</Txt></Row>}
        <Button title={confirmLabel} kind="dark" disabled={!ready} onPress={() => addr && onConfirm({ lat: addr.lat, lng: addr.lng, label: addr.label })} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pinWrap: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', paddingBottom: 44 }, // pin + stem + shadow are 48 tall with the tip at 46: this puts the tip on the centre
  pin: { width: 30, height: 30, borderRadius: 15, borderWidth: 3, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4 },
  pinDot: { width: 9, height: 9, borderRadius: 5 },
  stem: { width: 3, height: 16, borderRadius: 2 },
  shadowDot: { width: 10, height: 4, borderRadius: 5, backgroundColor: '#000', marginTop: -2 },
  card: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, gap: 12 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
