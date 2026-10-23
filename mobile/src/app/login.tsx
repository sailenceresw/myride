import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { apiUrlFor } from '@/lib/api';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SignIn } from '@/components/SignIn';
import { Hero, Icon, Row, Txt, type IconName } from '@/components/ui';
import { IS_DRIVE } from '@/lib/config';
import { shadow, useTheme } from '@/lib/theme';

const PERKS: [IconName, string][] = IS_DRIVE
  ? [['wallet-outline', 'Weekly payouts'], ['shield-checkmark-outline', 'Verified customers'], ['time-outline', 'Your hours']]
  : [['pricetag-outline', 'No surge'], ['map-outline', 'All 33 wards'], ['gift-outline', 'First ride free']];

/** Sign-in for this app's own users: customers in MyRide, approved riders in MyRide Drive. */
export default function Login() {
  const t = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
          <Hero style={{ paddingBottom: 56 }}>
            <Logo />
            <Text style={styles.brand}>{IS_DRIVE ? 'MyRide Drive' : 'MyRide'}</Text>
            <Text style={styles.tagline}>{IS_DRIVE ? 'Drive, deliver and haul in Pokhara.' : 'Rides, parcels and logistics across Pokhara.'}</Text>
            <Row style={{ flexWrap: 'wrap', marginTop: 16 }}>
              {PERKS.map(([icon, text]) => <View key={text} style={styles.perk}><Icon name={icon} size={14} color="#fff" /><Text style={styles.perkText}>{text}</Text></View>)}
            </Row>
          </Hero>

          <SignIn referral={!IS_DRIVE} onDone={() => router.replace('/')} />

          {/* The rider journey has its own page, so customer sign-in stays customer-only. */}
          {!IS_DRIVE && (
            <Pressable onPress={() => router.push('/become-rider')} accessibilityRole="link" style={({ pressed }) => [styles.earn, { backgroundColor: t.card, borderColor: t.line, opacity: pressed ? 0.7 : 1 }]}>
              <Text style={{ fontSize: 30 }}>🏍️</Text>
              <View style={{ flex: 1 }}>
                <Txt style={{ fontWeight: '800' }}>Want to earn with MyRide?</Txt>
                <Txt kind="small">Become a rider with your motorcycle, car or van.</Txt>
              </View>
              <Icon name="chevron-forward" size={22} color={t.muted} />
            </Pressable>
          )}

          <Pressable onPress={() => WebBrowser.openBrowserAsync(apiUrlFor('/privacy.html'))} accessibilityRole="link" style={{ marginTop: 'auto', paddingVertical: 20, paddingHorizontal: 16 }}>
            <Row style={{ justifyContent: 'center' }}>
              <Icon name="lock-closed" size={13} color={t.muted} />
              <Txt kind="small">Your number is never shown in trip details. <Text style={{ color: t.brand, fontWeight: '700' }}>Privacy</Text></Txt>
            </Row>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** App mark: a navigation arrow on a white tile (teal for MyRide, ink for MyRide Drive). */
export function Logo({ size = 60, dark = IS_DRIVE }: { size?: number; dark?: boolean }) {
  const t = useTheme();
  return (
    <View style={[styles.logo, shadow(6), { width: size, height: size, borderRadius: size * 0.28 }]}>
      <Icon name="navigate" size={size * 0.52} color={dark ? '#101a19' : t.brand} />
    </View>
  );
}

const styles = StyleSheet.create({
  logo: { backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  brand: { color: '#fff', fontSize: 34, fontWeight: '900', letterSpacing: -0.5 },
  tagline: { color: '#ffffffd0', fontSize: 15, marginTop: 4 },
  perk: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#ffffff22', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6 },
  perkText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  earn: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 14, borderRadius: 20, borderWidth: 1.5, padding: 16 },
});
