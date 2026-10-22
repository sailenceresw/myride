import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Avatar, Button, Card, Icon, Plate, Pulse, Row, Steps, Txt, type IconName } from '@/components/ui';
import { apiUrlFor, rs, type Trip } from '@/lib/api';
import { call } from '@/lib/config';
import { RADIUS, useTheme, vehicleEmoji } from '@/lib/theme';

// On screen, "rider" is the person driving (see mobile/AGENTS.md).
const STATUS: Record<string, string> = {
  searching: 'Finding your rider…', accepted: 'Your rider is on the way', arrived: 'Your rider has arrived', in_progress: 'Enjoy your ride',
  completed: 'You have arrived', cancelled: 'Trip cancelled', no_driver: 'No riders available right now', scheduled: 'Scheduled',
};
const STEP_OF: Record<string, number> = { searching: 0, accepted: 1, arrived: 2, in_progress: 3 };

/** The customer's current trip: status, rider, PIN, call / share / SOS, receipt and rating. */
export function TripPanel({ trip, err, onCancel, onRate, onSos, onDone }: { trip: Trip; err: string; onCancel: () => void; onRate: (s: number) => void; onSos: () => void; onDone: () => void }) {
  const t = useTheme();
  const d = trip.driver;
  const is = (...s: string[]) => s.includes(trip.status);
  const live = is('accepted', 'arrived', 'in_progress');
  const share = () => Share.share({ message: `Track my MyRide trip live: ${apiUrlFor(`/track.html?t=${trip.shareToken}`)}` });
  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Txt kind="h1">{STATUS[trip.status] ?? trip.status}</Txt>
          <Txt kind="muted" numberOfLines={1}>{trip.pickup.label} → {trip.drop.label} · {trip.route.km.toFixed(1)} km</Txt>
        </View>
        {is('searching') && <Pulse size={52} color={t.brand}><View style={[styles.pulseCore, { backgroundColor: t.brand }]}><Text style={{ fontSize: 22 }}>{vehicleEmoji(trip.service)}</Text></View></Pulse>}
      </Row>
      {trip.status in STEP_OF && <Steps steps={['Booked', 'Coming', 'Pickup', 'On trip']} at={STEP_OF[trip.status]} />}
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
          <Action icon="call" label="Call" onPress={() => call(d.phone)} />
          <Action icon="share-social" label="Share trip" onPress={share} />
          <Action icon="warning" label="SOS" onPress={onSos} danger />
        </Row>
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
          <View style={{ alignItems: 'center', marginTop: 8 }}>
            <Txt kind="muted">{trip.riderRating ? 'Thanks for rating!' : `How was your trip with ${d?.name.split(' ')[0] ?? 'your rider'}?`}</Txt>
            <Row style={{ marginVertical: 4, gap: 6 }}>
              {[1, 2, 3, 4, 5].map((s) => (
                <Pressable key={s} disabled={!!trip.riderRating} onPress={() => onRate(s)} accessibilityLabel={`${s} stars`} hitSlop={4}>
                  <Icon name={(trip.riderRating?.stars ?? 0) >= s ? 'star' : 'star-outline'} size={36} color={(trip.riderRating?.stars ?? 0) >= s ? t.accent : t.line} />
                </Pressable>
              ))}
            </Row>
          </View>
        </>
      )}

      {!!err && <Row style={{ marginTop: 10 }}><Icon name="alert-circle" size={18} color={t.danger} /><Text style={{ color: t.danger, flex: 1 }}>{err}</Text></Row>}
      {is('searching', 'accepted', 'arrived', 'scheduled') && <Button title="Cancel trip" kind="ghost" onPress={onCancel} style={{ marginTop: 12 }} />}
      {is('completed', 'cancelled', 'no_driver') && <Button title={is('completed') ? 'Done' : 'Book again'} onPress={onDone} style={{ marginTop: 10 }} />}
    </ScrollView>
  );
}

function Action({ icon, label, onPress, danger }: { icon: IconName; label: string; onPress: () => void; danger?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, { backgroundColor: danger ? t.dangerSoft : t.chip, opacity: pressed ? 0.7 : 1 }]}>
      <Icon name={icon} size={20} color={danger ? t.danger : t.ink} /><Text style={{ fontSize: 12, fontWeight: '700', color: danger ? t.danger : t.ink }}>{label}</Text>
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
});
