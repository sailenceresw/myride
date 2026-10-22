import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, BackHeader, Chip, Icon, RoundButton, Row, Txt } from '@/components/ui';
import { api, type ChatMessage } from '@/lib/api';
import { call } from '@/lib/config';
import { RADIUS, useTheme } from '@/lib/theme';

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/**
 * In-trip chat between the customer and the rider (both apps). The parent owns the message list (it also
 * receives live messages while the chat is closed, for the unread badge); this screen shows and sends.
 */
export function TripChat({ visible, onClose, tripId, me, name, subtitle, phone, messages, onSent, quickReplies, open }: {
  visible: boolean; onClose: () => void; tripId: string; me: 'rider' | 'driver'; name: string; subtitle?: string; phone?: string;
  messages: ChatMessage[]; onSent: (m: ChatMessage) => void; quickReplies: string[]; open: boolean; // open = the trip still allows messages
}) {
  const t = useTheme();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const list = useRef<FlatList<ChatMessage>>(null);

  useEffect(() => { if (visible) setTimeout(() => list.current?.scrollToEnd({ animated: false }), 50); }, [visible, messages.length]);

  async function send(body: string) {
    const msg = body.trim();
    if (!msg || sending) return;
    setSending(true); setErr('');
    try { onSent(await api<ChatMessage>('POST', `/api/trips/${tripId}/messages`, { text: msg })); setText(''); } catch (e) { setErr((e as Error).message); }
    setSending(false);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <Row style={[styles.header, { borderColor: t.line }]}>
            <View style={{ flex: 1 }}><BackHeader title="" onBack={onClose} /></View>
            <Avatar name={name} size={38} />
            <View style={{ flex: 3 }}>
              <Txt style={{ fontWeight: '800' }} numberOfLines={1}>{name}</Txt>
              {!!subtitle && <Txt kind="small" numberOfLines={1}>{subtitle}</Txt>}
            </View>
            {!!phone && <RoundButton icon="call" label={`Call ${name}`} onPress={() => call(phone)} size={42} />}
          </Row>

          <FlatList
            ref={list}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ padding: 16, gap: 6, flexGrow: 1 }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Icon name="chatbubbles-outline" size={48} color={t.line} />
                <Txt kind="muted" style={{ textAlign: 'center' }}>{me === 'rider' ? `Send ${name.split(' ')[0]} a message: where exactly you are, or a landmark.` : 'Send the customer a message.'}</Txt>
                <Txt kind="small" style={{ textAlign: 'center' }}>Your phone number stays private in chat.</Txt>
              </View>
            }
            renderItem={({ item }) => {
              const mine = item.from === me;
              return (
                <View style={[styles.bubble, mine ? { alignSelf: 'flex-end', backgroundColor: t.ink, borderBottomRightRadius: 4 } : { alignSelf: 'flex-start', backgroundColor: t.card, borderBottomLeftRadius: 4 }]}>
                  <Text style={{ color: mine ? t.card : t.ink, fontSize: 15 }}>{item.text}</Text>
                  <Text style={{ color: mine ? t.card : t.muted, opacity: 0.7, fontSize: 10, alignSelf: 'flex-end', marginTop: 2 }}>{time(item.at)}</Text>
                </View>
              );
            }}
          />

          {open ? (
            <View style={[styles.composer, { borderColor: t.line, backgroundColor: t.card }]}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
                {quickReplies.map((q) => <Chip key={q} label={q} onPress={() => send(q)} />)}
              </ScrollView>
              {!!err && <Txt kind="small" style={{ color: t.danger, marginBottom: 6 }}>{err}</Txt>}
              <Row style={{ gap: 8 }}>
                <TextInput value={text} onChangeText={setText} placeholder="Message" placeholderTextColor={t.muted} maxLength={300} multiline style={[styles.input, { borderColor: t.line, color: t.ink, backgroundColor: t.bg }]} />
                <Pressable onPress={() => send(text)} disabled={!text.trim() || sending} accessibilityLabel="Send" style={[styles.send, { backgroundColor: text.trim() ? t.ink : t.line }]}>
                  {sending ? <ActivityIndicator color={t.card} /> : <Icon name="send" size={18} color={t.card} />}
                </Pressable>
              </Row>
            </View>
          ) : (
            <View style={[styles.composer, { borderColor: t.line, backgroundColor: t.card }]}><Txt kind="muted" style={{ textAlign: 'center' }}>Chat has ended with the trip.</Txt></View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { gap: 10, paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32 },
  bubble: { maxWidth: '80%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
  composer: { padding: 12, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, maxHeight: 110 },
  send: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
});
