import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewProps } from 'react-native-webview';
import { GRADIENT, RADIUS, shadow, useTheme } from '@/lib/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];
export const Icon = ({ name, size = 22, color }: { name: IconName; size?: number; color?: string }) => {
  const t = useTheme();
  return <Ionicons name={name} size={size} color={color ?? t.ink} />;
};

type Kind = 'primary' | 'ghost' | 'danger' | 'accent' | 'dark' | 'soft';
export function Button({ title, onPress, kind = 'primary', icon, disabled, loading, style }: {
  title: string; onPress: () => void; kind?: Kind; icon?: IconName; disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const [bg, fg] = { primary: [t.brand, '#fff'], ghost: ['transparent', t.brand], danger: [t.danger, '#fff'], accent: [t.accent, '#1d1405'], dark: [t.ink, t.card], soft: [t.chip, t.ink] }[kind];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.btn, { backgroundColor: bg, borderColor: kind === 'ghost' ? t.line : bg, opacity: disabled ? 0.45 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : (
        <Row style={{ gap: 8 }}>{icon && <Icon name={icon} size={19} color={fg} />}<Text style={[styles.btnText, { color: fg }]}>{title}</Text></Row>
      )}
    </Pressable>
  );
}

/** Round floating button (map controls, call, account). */
export function RoundButton({ icon, label, onPress, color, style, size = 48 }: { icon: IconName; label: string; onPress: () => void; color?: string; style?: StyleProp<ViewStyle>; size?: number }) {
  const t = useTheme();
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.center, shadow(5), { width: size, height: size, borderRadius: size / 2, backgroundColor: t.card, transform: [{ scale: pressed ? 0.94 : 1 }] }, style]}>
      <Icon name={icon} size={size * 0.46} color={color} />
    </Pressable>
  );
}

export function Card({ children, style, selected, onPress, raised }: { children: ReactNode; style?: StyleProp<ViewStyle>; selected?: boolean; onPress?: () => void; raised?: boolean }) {
  const t = useTheme();
  const body = <View style={[styles.card, raised && shadow(4), { backgroundColor: selected ? t.brandSoft : t.card, borderColor: selected ? t.brand : t.line, borderWidth: selected ? 2 : 1 }, style]}>{children}</View>;
  return onPress ? <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.99 : 1 }] })}>{body}</Pressable> : body;
}

/** Uber-style bottom sheet over the full-screen map. `onHeight` lets the map keep the route clear of it. */
export function Sheet({ children, onHeight, footer }: { children: ReactNode; onHeight?: (h: number) => void; footer?: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View onLayout={(e) => onHeight?.(e.nativeEvent.layout.height)} style={[styles.sheet, shadow(16), { backgroundColor: t.card, paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={[styles.grabber, { backgroundColor: t.line }]} />
      <View style={{ flexShrink: 1 }}>{children}</View>
      {footer && <View style={[styles.footer, { borderColor: t.line }]}>{footer}</View>}
    </View>
  );
}

const TXT = {
  title: { fontSize: 30, fontWeight: '900', letterSpacing: -0.5 },
  h1: { fontSize: 24, fontWeight: '800', letterSpacing: -0.3 },
  h2: { fontSize: 18, fontWeight: '800' },
  body: { fontSize: 15 },
  muted: { fontSize: 14 },
  small: { fontSize: 12 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  price: { fontSize: 18, fontWeight: '800' },
} as const;

export function Txt({ children, kind = 'body', style, numberOfLines }: { children: ReactNode; kind?: keyof typeof TXT; style?: object; numberOfLines?: number }) {
  const t = useTheme();
  return <Text numberOfLines={numberOfLines} style={[TXT[kind], { color: ['muted', 'small', 'label'].includes(kind) ? t.muted : t.ink }, style]}>{children}</Text>;
}

/** Small status badge: solid (`color`) or soft tint (`tint` background + `color` text). */
export const Pill = ({ text, color, tint, icon }: { text: string; color: string; tint?: string; icon?: IconName }) => (
  <View style={[styles.pill, { backgroundColor: tint ?? color }]}>
    {icon && <Ionicons name={icon} size={11} color={tint ? color : '#fff'} />}
    <Text style={{ fontSize: 11, fontWeight: '800', color: tint ? color : '#fff' }}>{text}</Text>
  </View>
);

/** Selectable chip (service tabs, payment methods, quick places). */
export function Chip({ label, icon, active, onPress, onLongPress }: { label: string; icon?: IconName; active?: boolean; onPress: () => void; onLongPress?: () => void }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} onLongPress={onLongPress} style={[styles.chip, { backgroundColor: active ? t.ink : t.chip }]}>
      {icon && <Icon name={icon} size={16} color={active ? t.card : t.ink} />}
      <Text style={{ color: active ? t.card : t.ink, fontWeight: '700', fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

export const Row = ({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) => <View style={[styles.row, style]}>{children}</View>;

/** Initials avatar (drivers, profile). */
export function Avatar({ name, size = 48 }: { name: string; size?: number }) {
  const initials = name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <LinearGradient colors={GRADIENT} style={[styles.center, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.38 }}>{initials}</Text>
    </LinearGradient>
  );
}

/** Nepali number plate (public vehicles: white on black). */
export const Plate = ({ text }: { text: string }) => (
  <View style={styles.plate}><Text style={styles.plateText}>{text}</Text></View>
);

/** Horizontal progress steps (trip status). */
export function Steps({ steps, at }: { steps: string[]; at: number }) {
  const t = useTheme();
  return (
    <View style={{ marginVertical: 10 }}>
      <Row style={{ gap: 4 }}>{steps.map((s, i) => <View key={s} style={[styles.bar, { backgroundColor: i <= at ? t.brand : t.line }]} />)}</Row>
      <Row style={{ justifyContent: 'space-between', marginTop: 6 }}>
        {steps.map((s, i) => <Text key={s} style={{ fontSize: 11, fontWeight: i === at ? '800' : '500', color: i <= at ? t.ink : t.muted }}>{s}</Text>)}
      </Row>
    </View>
  );
}

/** Soft pulsing ring (searching for a driver, GO button). */
export function Pulse({ size, color, children }: { size: number; color: string; children: ReactNode }) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1600, easing: Easing.out(Easing.ease), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [v]);
  const ring = { position: 'absolute' as const, width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }] };
  return <View style={[styles.center, { width: size, height: size }]}><Animated.View style={ring} />{children}</View>;
}

/** Brand gradient header used by login, account and earnings. */
export function Hero({ children, style, colors = GRADIENT }: { children: ReactNode; style?: StyleProp<ViewStyle>; colors?: [string, string] }) {
  const insets = useSafeAreaInsets();
  return <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: 28 }, style]}><StatusBar style="light" />{children}</LinearGradient>;
}

/** Back, or to this app's home when there is no history (screen opened from a notification or deep link). */
export const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

/** Back button + title used by every pushed screen (`light` for use on a Hero). */
export function BackHeader({ title, light, onBack = goBack }: { title: string; light?: boolean; onBack?: () => void }) {
  const t = useTheme();
  const c = light ? '#fff' : t.ink;
  return (
    <Row style={{ paddingVertical: 8, gap: 12 }}>
      {/* Each screen sets its own status bar: a Hero screen underneath must not leave white icons on a light page. */}
      <StatusBar style={light ? 'light' : 'auto'} />
      <Pressable onPress={onBack} accessibilityLabel="Back" hitSlop={10} style={[styles.center, { width: 40, height: 40, borderRadius: 20, backgroundColor: light ? '#ffffff22' : t.chip }]}>
        <Icon name="chevron-back" size={22} color={c} />
      </Pressable>
      <Text style={[TXT.h2, { color: c }]}>{title}</Text>
    </Row>
  );
}

/** List row with a leading icon (account, settings). */
export function ListRow({ icon, title, subtitle, right, onPress }: { icon: IconName; title: string; subtitle?: string; right?: ReactNode; onPress?: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.listRow, { opacity: pressed ? 0.7 : 1 }]}>
      <View style={[styles.center, { width: 40, height: 40, borderRadius: 12, backgroundColor: t.brandSoft }]}><Icon name={icon} size={20} color={t.brand} /></View>
      <View style={{ flex: 1 }}><Txt style={{ fontWeight: '700' }}>{title}</Txt>{subtitle && <Txt kind="small">{subtitle}</Txt>}</View>
      {right ?? (onPress && <Icon name="chevron-forward" size={18} color={t.muted} />)}
    </Pressable>
  );
}

/** Full-screen in-app web page (KYC wizard, selfie check) with camera access. */
export function WebScreen({ title, ...props }: { title: string } & WebViewProps) {
  const t = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ paddingHorizontal: 12 }}><BackHeader title={title} /></View>
      <WebView mediaCapturePermissionGrantType="grant" allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} javaScriptEnabled domStorageEnabled style={{ flex: 1 }} {...props} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  btn: { borderRadius: RADIUS.md, paddingVertical: 15, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, minHeight: 52 },
  btnText: { fontSize: 16, fontWeight: '800' },
  card: { borderRadius: RADIUS.lg - 4, padding: 14, marginVertical: 5 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 16, paddingTop: 8, maxHeight: '62%' },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, marginTop: 6, gap: 10 },
  grabber: { width: 44, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 12 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.pill, alignSelf: 'flex-start' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: RADIUS.pill },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  plate: { backgroundColor: '#111', borderRadius: 6, borderWidth: 2, borderColor: '#e5e5e5', paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  plateText: { color: '#fff', fontWeight: '800', fontSize: 14, letterSpacing: 1 },
  bar: { flex: 1, height: 4, borderRadius: 2 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
});
