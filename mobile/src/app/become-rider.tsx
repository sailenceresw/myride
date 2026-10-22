import { Redirect, router } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SignIn } from '@/components/SignIn';
import { BackHeader, Button, Card, Hero, ListRow, Row, Txt, type IconName } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { IS_DRIVE } from '@/lib/config';
import { DRIVER_GRADIENT, useTheme } from '@/lib/theme';

const WHY: [IconName, string, string][] = [
  ['cash-outline', 'Keep 88–90% of every fare', 'Partners with their own vehicle; MyRide takes 10–12%'],
  ['calendar-outline', 'Paid every Sunday', 'Straight to your own bank account'],
  ['time-outline', 'Choose your hours', 'Go online when you want (up to 12 hours a day)'],
  ['briefcase-outline', 'No vehicle? Join the fleet', 'Salaried MyRide fleet job with SSF and overtime'],
];
const NEED = ['Citizenship certificate', 'Driving licence (category for your vehicle)', 'Police clearance report', 'Bluebook and insurance (own vehicle)', 'Bank account in your name'];
const STEPS: [string, string][] = [
  ['Apply here in about 10 minutes', 'Your details, vehicle, bank and photos of your documents'],
  ['MyRide verifies you', 'Usually within 48 hours. We send you an SMS'],
  ['Install MyRide Drive and earn', 'Sign in with the same number, take a selfie, tap GO'],
];

/** The rider journey's own page in the customer app: what you get, what you need, how it works, then apply. */
export default function BecomeRider() {
  const t = useTheme();
  const { token, profile } = useAuth();
  const app = profile?.driverApplication?.status;
  const start = () => router.push('/customer/apply');
  if (IS_DRIVE) return <Redirect href="/" />; // MyRide Drive has its own application on the driver home
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
          <Hero colors={DRIVER_GRADIENT} style={{ paddingBottom: 48 }}>
            <BackHeader title="" light />
            <Text style={styles.title}>Earn with MyRide</Text>
            <Text style={styles.sub}>Become a MyRide rider with your motorcycle, car, van or truck, or join the MyRide fleet.</Text>
          </Hero>

          <View style={{ paddingHorizontal: 16, marginTop: -28, gap: 6 }}>
            <Card raised>{WHY.map(([icon, title, subtitle]) => <ListRow key={title} icon={icon} title={title} subtitle={subtitle} />)}</Card>

            <Txt kind="label" style={styles.section}>How it works</Txt>
            <Card>
              {STEPS.map(([title, subtitle], i) => (
                <Row key={title} style={{ gap: 12, paddingVertical: 10, alignItems: 'flex-start' }}>
                  <View style={[styles.num, { backgroundColor: t.ink }]}><Text style={{ color: t.card, fontWeight: '900' }}>{i + 1}</Text></View>
                  <View style={{ flex: 1 }}><Txt style={{ fontWeight: '800' }}>{title}</Txt><Txt kind="small">{subtitle}</Txt></View>
                </Row>
              ))}
            </Card>

            <Txt kind="label" style={styles.section}>Keep these ready</Txt>
            <Card>{NEED.map((n) => <Row key={n} style={{ paddingVertical: 6 }}><Text style={{ color: t.ok, fontWeight: '900' }}>✓</Text><Txt>{n}</Txt></Row>)}</Card>
          </View>

          {token ? (
            <View style={{ paddingHorizontal: 16, marginTop: 14 }}>
              <Button title={app && app !== 'draft' ? 'See my application' : app ? 'Continue my application' : 'Start my application'} icon="arrow-forward" kind="dark" onPress={start} />
            </View>
          ) : (
            // Not signed in yet: sign in here, then go straight to the application (never via the customer sign-in).
            <View style={{ marginTop: 46 }}>
              <SignIn title="Sign in to apply" onDone={() => { router.replace('/customer'); start(); }} />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { color: '#fff', fontSize: 32, fontWeight: '900', letterSpacing: -0.5, marginTop: 6 },
  sub: { color: '#ffffffc8', fontSize: 15, lineHeight: 21, marginTop: 6 },
  section: { marginTop: 12, marginBottom: 2 },
  num: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
