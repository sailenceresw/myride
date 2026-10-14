import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import MapView, { UrlTile, type MapViewProps } from 'react-native-maps';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewProps } from 'react-native-webview';
import { POKHARA } from '@/lib/config';
import { useTheme } from '@/lib/theme';

export function Button({ title, onPress, kind = 'primary', disabled, loading, style }: {
  title: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger' | 'accent' | 'dark'; disabled?: boolean; loading?: boolean; style?: ViewStyle;
}) {
  const t = useTheme();
  const bg = { primary: t.brand, ghost: 'transparent', danger: t.danger, accent: t.accent, dark: t.ink }[kind];
  const fg = { primary: '#fff', ghost: t.brand, danger: '#fff', accent: '#1d1405', dark: t.bg }[kind];
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

/** Round floating button (map controls, call, account). */
export function RoundButton({ icon, label, onPress, style }: { icon: string; label: string; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} style={[styles.round, { backgroundColor: t.card }, style]}>
      <Text style={{ fontSize: 20 }}>{icon}</Text>
    </Pressable>
  );
}

export function Card({ children, style, selected, onPress }: { children: ReactNode; style?: ViewStyle; selected?: boolean; onPress?: () => void }) {
  const t = useTheme();
  const body = <View style={[styles.card, { backgroundColor: t.card, borderColor: selected ? t.brand : t.line, borderWidth: selected ? 2 : 1 }, style]}>{children}</View>;
  return onPress ? <Pressable accessibilityRole="button" onPress={onPress}>{body}</Pressable> : body;
}

/** Uber-style bottom sheet sitting over the full-screen map. */
export function Sheet({ children }: { children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.sheet, { backgroundColor: t.card, paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={[styles.grabber, { backgroundColor: t.line }]} />
      {children}
    </View>
  );
}

const TXT = {
  h1: { fontSize: 24, fontWeight: '800' },
  h2: { fontSize: 18, fontWeight: '700' },
  body: { fontSize: 15 },
  muted: { fontSize: 14 },
  small: { fontSize: 12 },
  price: { fontSize: 18, fontWeight: '800' },
} as const;

export function Txt({ children, kind = 'body', style, numberOfLines }: { children: ReactNode; kind?: keyof typeof TXT; style?: object; numberOfLines?: number }) {
  const t = useTheme();
  return <Text numberOfLines={numberOfLines} style={[TXT[kind], { color: ['muted', 'small'].includes(kind) ? t.muted : t.ink }, style]}>{children}</Text>;
}

export const Pill = ({ text, color }: { text: string; color: string }) => (
  <View style={[styles.pill, { backgroundColor: color }]}><Text style={{ fontSize: 11, fontWeight: '700', color: '#fff' }}>{text}</Text></View>
);

export const Row = ({ children, style }: { children: ReactNode; style?: ViewStyle }) => <View style={[styles.row, style]}>{children}</View>;

/** "← Title" header used by every pushed screen. */
export function BackHeader({ title, kind = 'h2' }: { title: string; kind?: 'h1' | 'h2' }) {
  const t = useTheme();
  return (
    <Row style={{ padding: 12 }}>
      <Pressable onPress={() => router.back()} accessibilityLabel="Back"><Text style={{ fontSize: 24, color: t.ink }}>←</Text></Pressable>
      <Txt kind={kind}>{title}</Txt>
    </Row>
  );
}

/** Full-screen in-app web page (KYC wizard, selfie check) with camera access. */
export function WebScreen({ title, ...props }: { title: string } & WebViewProps) {
  const t = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <BackHeader title={title} />
      <WebView mediaCapturePermissionGrantType="grant" allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} javaScriptEnabled domStorageEnabled style={{ flex: 1 }} {...props} />
    </SafeAreaView>
  );
}

// Store builds use Google/Apple base maps (set EXPO_PUBLIC_HAS_MAPS_KEY with GOOGLE_MAPS_*_KEY). Without a key
// (e.g. Expo Go on an emulator → Google "Authorization failure") draw free CARTO tiles instead.
const NO_MAPS_KEY = !process.env.EXPO_PUBLIC_HAS_MAPS_KEY;

/** The app's MapView: Pokhara by default, with the dev tile fallback built in. */
export function AppMap({ children, ref, ...props }: MapViewProps & { ref?: React.Ref<MapView> }) {
  return (
    <MapView
      ref={ref}
      style={StyleSheet.absoluteFill}
      mapType={NO_MAPS_KEY ? 'none' : 'standard'}
      initialRegion={{ ...POKHARA, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
      {...props}
    >
      {NO_MAPS_KEY && <UrlTile urlTemplate="https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png" maximumZ={19} shouldReplaceMapContent tileSize={256} />}
      {children}
    </MapView>
  );
}

const shadow = { shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, elevation: 6 };
const styles = StyleSheet.create({
  btn: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, minHeight: 50 },
  btnText: { fontSize: 16, fontWeight: '700' },
  round: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', ...shadow },
  card: { borderRadius: 14, padding: 14, marginVertical: 5 },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 8,
    ...shadow, shadowOpacity: 0.18, shadowRadius: 16, elevation: 16, maxHeight: '72%',
  },
  grabber: { width: 40, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 10 },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99, alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
