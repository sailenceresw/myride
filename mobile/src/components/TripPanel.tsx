import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Avatar, Button, Card, Chip, Icon, Plate, Pulse, Row, Steps, Txt, type IconName } from '@/components/ui';
import { rs, type Point, type Trip } from '@/lib/api';
import { callOnTrip } from '@/lib/tripCall';
import { RADIUS, useTheme, vehicleEmoji } from '@/lib/theme';
import { useNow } from '@/lib/useNow';

// On screen, "rider" is the person driving (see mobile/AGENTS.md).
const STATUS: Record<string, string> = {
  searching: 'Finding your rider…', accepted: 'Your rider is on the way', arrived: 'Your rider has arrived', in_progress: 'Enjoy your ride',
  completed: 'You have arrived', cancelled: 'Trip cancelled', no_driver: 'No riders available right now', scheduled: 'Scheduled',
};
const STEP_OF: Record<string, number> = { searching: 0, accepted: 1, arrived: 2, in_progress: 3 };
const PRAISE = ['Great driving', 'On time', 'Friendly', 'Clean vehicle', 'Knew the way', 'Safe helmet'];
const PROBLEMS = ['Late pickup', 'Unsafe driving', 'Rude', 'Took a longer route', 'Dirty vehicle', 'Asked for more money'];

// Road minutes between two points at Pokhara traffic speed (straight line × 1.33 detour, 22 km/h), never under 1.
const roadMin = (a: Point, b: Point) => {
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return Math.max(1, Math.round(((12742 * Math.asin(Math.sqrt(h)) * 1.33) / 22) * 60));
};
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** The customer's current trip: live ETA, rider, PIN, call / share / SOS, receipt and rating. */
export function TripPanel({ trip, err, unread, onMessage, onShare, onCancel, onRate, onSos, onDone }: {
  trip: Trip; err: string; unread: number; onMessage: () => void; onShare: () => void; onCancel: () => void; onRate: (s: number, comment: string) => void; onSos: () => void; onDone: () => void;
}) {
  const t = useTheme();
  const now = useNow();
  const d = trip.driver;
  const is = (...s: string[]) => s.includes(trip.status);
  const live =is('accepted', 'arrived', 'in_progress');
  // Live ETA from the rider's position, like Uber's "Arriving in 3 min" / "Arrive by 4:32 PM".
  const headline = is('accepted') && d?.loc ? `Arriving in ${roadMin(d.loc, trip.pickup)} min`
    : is('in_progress') && d?.loc ? `Arrive by ${clock(now + roadMin(d.loc, trip.drop) * 60000)}`
      : STATUS[trip.status] ?? trip.status;
  return (
    <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Txt kind="h1">{headline}</Txt>
          {headline !== STATUS[trip.status] && <Txt style={{ fontWeight: '700' }}>{STATUS[trip.status]}</Txt>}
          <Txt kind="muted" numberOfLines={1}>{trip.pickup.label} → {trip.stops?.length ? `${trip.stops.length} stop${trip.stops.length > 1 ? 's' : ''} → ` : ''}{trip.drop.label} · {trip.route.km.toFixed(1)} km</Txt>
        </View>
        {is('searching') && <Pulse size={52} color={t.brand}><View style={[styles.pulseCore, { backgroundColor: t.brand }]}><Text style={{ fontSize: 22 }}>{vehicleEmoji(trip.service)}</Text></View></Pulse>}
      </Row>
      {trip.status in STEP_OF && <Steps steps={['Booked', 'Coming', 'Pickup', 'On trip']} at={STEP_OF[trip.status]} />}
      {is('in_progress') && !!trip.stops?.length && (() => {
        const done = trip.stopsDone ?? 0;
        const next = trip.stops[done];
        return (
          <Row style={{ marginTop: 6 }}>
            <Icon name={next ? 'flag-outline' : 'checkmark-done'} size={16} color={t.brand} />
            <Txt kind="small" style={{ flex: 1 }}>{next ? `Next: stop ${done + 1} of ${trip.stops.length}, ${next.label}` : `Stops done: on to ${trip.drop.label}`}</Txt>
          </Row>
        );
      })()}
      {is('searching') && <Txt kind="small">Offering your trip to the nearest riders…</Txt>}
      {is('scheduled') && !!trip.scheduledAt && (
        <Row style={{ marginTop: 8 }}>
          <Icon name="calendar-outline" size={18} color={t.brand} />
          <Txt style={{ flex: 1 }}>Pickup {new Date(trip.scheduledAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}. We start finding your rider shortly before.</Txt>
        </Row>
      )}

      {d && (
        <Card raised style={{ marginTop: 8 }}>
          <Row style={{ gap: 12 }}>
            <Avatar name={d.name} size={52} />
            <View style={{ flex: 1, gap: 3 }}>
              <Row style={{ gap: 6 }}><Txt style={{ fontWeight: '800' }}>{d.name}</Txt><Icon name="star" size={13} color={t.accent} /><Txt kind="small">{d.rating}</Txt></Row>
              <Txt kind="small">{d.vehicle.model}{d.fleet ? ' · MyRide fleet' : ''}</Txt>
              <Plate text={d.vehicle.plate} />
            </View>
            <Text style={{ fontSize: 40 }}>{vehicleEmoji(d.vehicle.type)}</Text>
          </Row>
        </Card>
      )}

      {is('accepted', 'arrived') && <Code label="Tell your rider this PIN at pickup" code={trip.pin} />}
      {trip.kind === 'delivery' && trip.deliveryOtp && live && <Code label={`Delivery code (also sent to ${trip.recipient?.name} by SMS)`} code={trip.deliveryOtp} />}

      {live && d && (
        <Row style={{ marginTop: 10 }}>
          <Action icon="chatbubble-ellipses" label="Message" onPress={onMessage} badge={unread} />
          <Action icon="call" label="Call" onPress={() => callOnTrip(trip.id)} />
          <Action icon="share-social" label="Share trip" onPress={onShare} />
          <Action icon="warning" label="SOS" onPress={onSos} danger />
        </Row>
      )}
      {live && !!trip.sharedWith?.length && (
        <Pressable onPress={onShare} style={{ marginTop: 8 }}>
          <Row><Icon name="eye-outline" size={16} color={t.ok} /><Txt kind="small" style={{ flex: 1 }}>Following your trip: {trip.sharedWith.map((c) => c.name.split(' ')[0]).join(', ')}</Txt></Row>
        </Pressable>
      )}

      {!is('completed') && (
        <Row style={{ justifyContent: 'space-between', marginTop: 12 }}>
          <Row><Icon name={trip.payment.method === 'cash' ? 'cash-outline' : 'wallet-outline'} size={18} color={t.muted} /><Txt kind="muted" style={{ textTransform: 'capitalize' }}>{trip.payment.method}</Txt></Row>
          <Txt kind="price" style={{ color: trip.fare === 0 ? t.ok : t.ink }}>{trip.fare === 0 ? 'FREE' : rs(trip.fare)}</Txt>
        </Row>
      )}

      {is('completed') && (
        <>
          <Card style={{ marginTop: 10, backgroundColor: t.bg }}>
            {trip.quote.lines.map((l, i) => <Row key={i} style={{ justifyContent: 'space-between', marginVertical: 2 }}><Txt kind="muted">{l.label}</Txt><Txt kind="muted">{l.amount < 0 ? '−' : ''}{rs(Math.abs(l.amount))}</Txt></Row>)}
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.line, marginVertical: 8 }} />
            <Row style={{ justifyContent: 'space-between' }}><Txt style={{ fontWeight: '800' }}>Total · {trip.payment.method}</Txt><Txt kind="price" style={{ color: trip.fare === 0 ? t.ok : t.ink }}>{trip.fare === 0 ? 'FREE' : rs(trip.fare)}</Txt></Row>
          </Card>
          <Rating trip={trip} onRate={onRate} />
        </>
      )}

      {!!err && <Row style={{ marginTop: 10 }}><Icon name="alert-circle" size={18} color={t.danger} /><Text style={{ color: t.danger, flex: 1 }}>{err}</Text></Row>}
      {is('searching', 'accepted', 'arrived', 'scheduled') && <Button title="Cancel trip" kind="ghost" onPress={onCancel} style={{ marginTop: 12 }} />}
      {is('completed', 'cancelled', 'no_driver') && <Button title={is('completed') ? 'Done' : 'Book again'} onPress={onDone} style={{ marginTop: 10 }} />}
    </ScrollView>
  );
}

/** Stars first, then what went well (or wrong) and an optional comment; nothing is sent until "Submit". */
function Rating({ trip, onRate }: { trip: Trip; onRate: (s: number, comment: string) => void }) {
  const t = useTheme();
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [text, setText] = useState('');
  const done = trip.riderRating?.stars;
  const shown = done ?? stars;
  const first = trip.driver?.name.split(' ')[0] ?? 'your rider';
  const options = stars >= 4 ? PRAISE : PROBLEMS;
  const toggle = (x: string) => setTags(tags.includes(x) ? tags.filter((y) => y !== x) : [...tags, x]);
  return (
    <View style={{ alignItems: 'center', marginTop: 8, gap: 6 }}>
      <Txt style={{ fontWeight: '700' }}>{done ? 'Thanks for rating!' : `How was your trip with ${first}?`}</Txt>
      <Row style={{ gap: 6 }}>
        {[1, 2, 3, 4, 5].map((s) => (
          <Pressable key={s} disabled={!!done} onPress={() => { setStars(s); if ((s >= 4) !== (stars >= 4)) setTags([]); }} accessibilityLabel={`${s} stars`} hitSlop={4}>
            <Icon name={shown >= s ? 'star' : 'star-outline'} size={38} color={shown >= s ? t.accent : t.line} />
          </Pressable>
        ))}
      </Row>
      {!done && stars > 0 && (
        <>
          <Txt kind="small">{stars >= 4 ? 'What went well?' : 'What went wrong?'}</Txt>
          <Row style={{ flexWrap: 'wrap', justifyContent: 'center' }}>{options.map((o) => <Chip key={o} label={o} active={tags.includes(o)} onPress={() => toggle(o)} />)}</Row>
          <TextInput value={text} onChangeText={setText} maxLength={200} placeholder="Add a comment (optional)" placeholderTextColor={t.muted} style={[styles.comment, { borderColor: t.line, color: t.ink, backgroundColor: t.bg }]} />
          <Button title="Submit rating" kind="dark" onPress={() => onRate(stars, [...tags, text.trim()].filter(Boolean).join('. '))} style={{ alignSelf: 'stretch' }} />
        </>
      )}
    </View>
  );
}

function Action({ icon, label, onPress, danger, badge }: { icon: IconName; label: string; onPress: () => void; danger?: boolean; badge?: number }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityLabel={badge ? `${label}, ${badge} unread` : label} style={({ pressed }) => [styles.action, { backgroundColor: danger ? t.dangerSoft : t.chip, opacity: pressed ? 0.7 : 1 }]}>
      <Icon name={icon} size={20} color={danger ? t.danger : t.ink} /><Text style={{ fontSize: 12, fontWeight: '700', color: danger ? t.danger : t.ink }}>{label}</Text>
      {!!badge && <View style={[styles.badge, { backgroundColor: t.danger }]}><Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text></View>}
    </Pressable>
  );
}

function Code({ label, code }: { label: string; code: string }) {
  const t = useTheme();
  return (
    <View style={{ marginTop: 12, gap: 8 }}>
      <Txt kind="small">{label}</Txt>
      <Row style={{ gap: 8 }}>
        {code.split('').map((c, i) => <View key={i} style={[styles.codeBox, { backgroundColor: t.brandSoft }]}><Text style={{ fontSize: 28, fontWeight: '900', color: t.brand }}>{c}</Text></View>)}
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  action: { flex: 1, alignItems: 'center', gap: 4, borderRadius: RADIUS.md, paddingVertical: 12 },
  pulseCore: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  codeBox: { width: 54, height: 62, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 6, right: 14, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  comment: { alignSelf: 'stretch', borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
});
