import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, Pill, Row, Txt } from '@/components/ui';
import { rs, type Quote } from '@/lib/api';
import { RADIUS, useTheme, vehicleEmoji } from '@/lib/theme';
import { useNow } from '@/lib/useNow';

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/**
 * One service in the fare list, like Uber's ride options: vehicle, seats, how soon a driver can be there,
 * when you'd arrive, the saving vs the cheapest competitor, and the price.
 */
export function QuoteRow({ q, selected, recommended, scheduled, onPress }: { q: Quote; selected: boolean; recommended: boolean; scheduled?: boolean; onPress: () => void }) {
  const t = useTheme();
  const now = useNow();
  if (q.unavailable) return <View style={[styles.quote, { opacity: 0.45 }]}><Text style={styles.qIcon}>{vehicleEmoji(q.service)}</Text><View style={{ flex: 1 }}><Txt style={{ fontWeight: '700' }}>{q.label.replace('MyRide ', '')}</Txt><Txt kind="small">{q.unavailable}</Txt></View></View>;
  const cheapest = q.competitors.reduce<Quote['competitors'][number] | null>((a, c) => (!a || c.estimate < a.estimate ? c : a), null);
  const save = cheapest && cheapest.estimate > q.total ? cheapest.estimate - q.total : 0;
  const none = !q.available;
  // Scheduled trips: the time is the user's choice, so only the trip length matters.
  const when = scheduled ? `${Math.round(q.min)} min trip`
    : none ? 'No riders nearby right now'
      : q.pickupMin ? `${q.pickupMin} min away · Drop-off ${clock(now + (q.pickupMin + q.min) * 60000)}` : `Drop-off ${clock(now + q.min * 60000)}`;
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} style={[styles.quote, { backgroundColor: selected ? t.chip : 'transparent', borderColor: selected ? t.ink : 'transparent' }]}>
      <Text style={styles.qIcon}>{vehicleEmoji(q.service)}</Text>
      <View style={{ flex: 1, gap: 2 }}>
        <Row style={{ gap: 6 }}>
          <Txt style={{ fontWeight: '800', fontSize: 16 }} numberOfLines={1}>{q.label.replace('MyRide ', '')}</Txt>
          {!!q.seats && <Row style={{ gap: 2 }}><Icon name="person" size={12} color={t.muted} /><Txt kind="small">{q.seats}</Txt></Row>}
        </Row>
        <Txt kind="small" style={none && !scheduled ? { color: t.accent } : undefined}>{when}{q.intercity ? ' · intercity' : ''}</Txt>
        {(recommended || save > 0) && (
          <Row style={{ gap: 6 }}>
            {recommended && <Pill text="Best for hills" color={t.accent} tint={t.accentSoft} icon="trending-up" />}
            {save > 0 && <Pill text={`Save ${rs(save)} vs ${cheapest!.name}`} color={t.ok} tint={t.okSoft} />}
          </Row>
        )}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Txt kind="price" style={{ color: q.total === 0 ? t.ok : t.ink }}>{q.total === 0 ? 'FREE' : rs(q.total)}</Txt>
        {q.split.promoCost > 0 && <Text style={{ color: t.muted, textDecorationLine: 'line-through', fontSize: 12 }}>{rs(q.gross)}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  quote: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.md, borderWidth: 2, paddingHorizontal: 10, paddingVertical: 10, marginVertical: 2 },
  qIcon: { fontSize: 34, width: 46, textAlign: 'center' },
});
