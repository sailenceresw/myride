import type { ErrorBoundaryProps } from 'expo-router';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Icon, Txt } from '@/components/ui';
import { reportError } from '@/lib/crash';
import { useTheme } from '@/lib/theme';

/** Shown instead of a blank screen when a screen crashes; the error is reported to MyRide ops. */
export function CrashScreen({ error, retry }: ErrorBoundaryProps) {
  const t = useTheme();
  useEffect(() => { reportError(error, { fatal: false, screen: 'render' }); }, [error]);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28 }}>
        <Icon name="construct-outline" size={56} color={t.muted} />
        <Txt kind="h2" style={{ textAlign: 'center' }}>Something went wrong</Txt>
        <Txt kind="muted" style={{ textAlign: 'center' }}>{"We've let the MyRide team know. Your trip and account are safe."}</Txt>
        <Button title="Try again" icon="refresh" onPress={retry} style={{ alignSelf: 'stretch', marginTop: 8 }} />
        <Button title="Go to home" kind="ghost" onPress={() => { router.replace('/'); retry(); }} style={{ alignSelf: 'stretch' }} />
      </View>
    </SafeAreaView>
  );
}
