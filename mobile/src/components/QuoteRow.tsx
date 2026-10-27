import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Pill, Row, Txt } from '@/components/ui';
import { rs, type Quote } from '@/lib/api';
import { RADIUS, useTheme, vehicleEmoji } from '@/lib/theme';

/** One service in the fare list: vehicle, ETA, saving vs the cheapest competitor, price. */
export function QuoteRow({ q, selected, recommended, onPress }: { q: Quote; selected: boolean; recommended: boolean; onPress: () => void }) {
  const t = useTheme();
  if (q.unavailable) return <View style={[styles.quote, { opacity: 0.45 }]}><Text style={styles.qIcon}>{vehicleEmoji(q.service)}</Text><View style={{ flex: 1 }}><Txt style={{ fontWeight: '700' }}>{q.label}</Txt><Txt kind="small">{q.unavailable}</Txt></View></View>;
  const cheapest = q.competitors.reduce<Quote['competitors'][number] | null>((a, c) => (!a || c.estimate < a.estimate ? c : a), null);
  const save = cheapest && cheapest.estimate > q.total ? cheapest.estimate - q.total : 0;
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} style={[styles.quote, { backgroundColor: selected ? t.brandSoft : 'transparent', borderColor: selected ? t.brand : 'transparent' }]}>
      <Text style={styles.qIcon}>{vehicleEmoji(q.service)}</Text>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt style={{ fontWeight: '800' }} numberOfLines={1}>{q.label.replace('MyRide ', '')}</Txt>
        <Txt kind="small">{q.min} min · {q.available ? `${q.available} nearby` : 'few nearby'}{q.intercity ? ' · intercity' : ''}</Txt>
        <Row style={{ gap: 6 }}>
          {recommended && <Pill text="Best for hills" color={t.accent} tint={t.accentSoft} icon="trending-up" />}
          {save > 0 && <Pill text={`Save ${rs(save)} vs ${cheapest!.name}`} color={t.ok} tint={t.okSoft} />}
        </Row>
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
