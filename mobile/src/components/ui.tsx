import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';

export function Button({ title, onPress, kind = 'primary', disabled, loading, style }: {
  title: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger' | 'accent' | 'dark'; disabled?: boolean; loading?: boolean; style?: ViewStyle;
}) {
  const t = useTheme();
  const bg = { primary: t.brand, ghost: 'transparent', danger: t.danger, accent: t.accent, dark: t.ink }[kind];
  const fg = kind === 'ghost' ? t.brand : kind === 'accent' ? '#1d1405' : kind === 'dark' ? t.bg : '#fff';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.btn, { backgroundColor: bg, borderColor: kind === 'ghost' ? t.line : bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.btnText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Card({ children, style, selected, onPress }: { children: ReactNode; style?: ViewStyle; selected?: boolean; onPress?: () => void }) {
  const t = useTheme();
  const body = <View style={[styles.card, { backgroundColor: t.card, borderColor: selected ? t.brand : t.line, borderWidth: selected ? 2 : 1 }, style]}>{children}</View>;
  return onPress ? <Pressable accessibilityRole="button" onPress={onPress}>{body}</Pressable> : body;
}

/** Uber-style bottom sheet sitting over the full-screen map. */
export function Sheet({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.sheet, { backgroundColor: t.card, paddingBottom: Math.max(insets.bottom, 12) }, style]}>
      <View style={[styles.grabber, { backgroundColor: t.line }]} />
      {children}
    </View>
  );
}

export function Txt({ children, kind = 'body', style, numberOfLines }: { children: ReactNode; kind?: 'h1' | 'h2' | 'body' | 'muted' | 'small' | 'price'; style?: object; numberOfLines?: number }) {
  const t = useTheme();
  const k = {
    h1: { fontSize: 24, fontWeight: '800' as const, color: t.ink },
    h2: { fontSize: 18, fontWeight: '700' as const, color: t.ink },
    body: { fontSize: 15, color: t.ink },
    muted: { fontSize: 14, color: t.muted },
    small: { fontSize: 12, color: t.muted },
    price: { fontSize: 18, fontWeight: '800' as const, color: t.ink },
  }[kind];
  return <Text numberOfLines={numberOfLines} style={[k, style]}>{children}</Text>;
}

export function Pill({ text, color }: { text: string; color?: string }) {
  const t = useTheme();
  return <View style={[styles.pill, { backgroundColor: color ?? '#e3f4f1' }]}><Text style={{ fontSize: 11, fontWeight: '700', color: color ? '#fff' : t.brandDark }}>{text}</Text></View>;
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  btn: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, minHeight: 50 },
  btnText: { fontSize: 16, fontWeight: '700' },
  card: { borderRadius: 14, padding: 14, marginVertical: 5 },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 8,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: -4 }, elevation: 16, maxHeight: '72%',
  },
  grabber: { width: 40, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 10 },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99, alignSelf: 'flex-start' },
});
