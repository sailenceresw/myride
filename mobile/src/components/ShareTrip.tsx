import { Contact } from 'expo-contacts';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Button, Icon, Row, Txt } from '@/components/ui';
import { api, apiUrlFor, type Trip } from '@/lib/api';
import { PHONE_RE } from '@/lib/config';
import { RADIUS, shadow, useTheme } from '@/lib/theme';

type Person = { name: string; phone: string };
const MAX = 5;
/** "+977 981-1111111" → "9811111111" */
const local = (p: string) => p.replace(/\D/g, '').replace(/^977(?=9\d{9}$)/, '');

/**
 * Share the live trip with close ones the customer chooses: they get an SMS with the live link now,
 * and again when the customer arrives (or presses SOS). People shared with before are one tap away.
 */
export function ShareTrip({ visible, onClose, trip, saved, onShared }: {
  visible: boolean; onClose: () => void; trip: Trip; saved: Person[]; onShared: (sharedWith: Person[]) => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const already = trip.sharedWith ?? [];
  const [extra, setExtra] = useState<Person[]>([]); // picked from contacts or typed this time
  const [picked, setPicked] = useState<string[]>([]);
  const [typing, setTyping] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const people = [...extra, ...saved.filter((s) => !extra.some((e) => e.phone === s.phone))];
  const isSent = (p: Person) => already.some((a) => a.phone === p.phone);
  const room = MAX - already.length;
  const toggle = (p: Person) => {
    setErr('');
    if (picked.includes(p.phone)) return setPicked(picked.filter((x) => x !== p.phone));
    if (picked.length >= room) return setErr(`You can share a trip with up to ${MAX} people.`);
    setPicked([...picked, p.phone]);
  };
  const add = (p: Person) => {
    if (!PHONE_RE.test(p.phone)) return setErr(`${p.name}: not a Nepali mobile number (98XXXXXXXX).`);
    setExtra((x) => [p, ...x.filter((y) => y.phone !== p.phone)]);
    if (!isSent(p) && !picked.includes(p.phone) && picked.length < room) setPicked((x) => [...x, p.phone]);
    setErr('');
  };

  async function fromContacts() {
    setErr('');
    try {
      const c = await Contact.presentPicker();
      if (!c) return;
      const [full, phones] = await Promise.all([c.getFullName(), c.getPhones()]);
      const mobile = phones.map((x) => local(x.number ?? '')).find((n) => PHONE_RE.test(n));
      if (!mobile) return setErr(`${full || 'That contact'} has no Nepali mobile number.`);
      add({ name: full || mobile, phone: mobile });
    } catch {
      setErr("Couldn't open your contacts. Type the number instead.");
      setTyping(true);
    }
  }

  async function send() {
    const chosen = people.filter((p) => picked.includes(p.phone));
    if (!chosen.length) return;
    setBusy(true); setErr('');
    try {
      const r = await api<{ sharedWith: Person[] }>('POST', `/api/trips/${trip.id}/share`, { contacts: chosen });
      onShared(r.sharedWith);
      setPicked([]); setExtra([]); setTyping(false);
      onClose();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  const link = apiUrlFor(`/track.html?t=${trip.shareToken}`);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.sheet, shadow(16), { backgroundColor: t.card, paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={[styles.grabber, { backgroundColor: t.line }]} />
          <Txt kind="h2">Share your trip</Txt>
          <Txt kind="small">They get an SMS with your live location and rider details now, and another when you arrive. Only the people you choose.</Txt>

          <ScrollView style={{ maxHeight: 300 }} keyboardShouldPersistTaps="handled">
            {people.map((p) => {
              const sent = isSent(p);
              const on = picked.includes(p.phone);
              return (
                <Pressable key={p.phone} disabled={sent} onPress={() => toggle(p)} style={[styles.person, { borderColor: t.line }]} accessibilityRole="checkbox" accessibilityState={{ checked: sent || on, disabled: sent }}>
                  <Avatar name={p.name} size={38} />
                  <View style={{ flex: 1 }}><Txt style={{ fontWeight: '700' }} numberOfLines={1}>{p.name}</Txt><Txt kind="small">+977 {p.phone}</Txt></View>
                  {sent ? <Row style={{ gap: 4 }}><Icon name="checkmark-done" size={18} color={t.ok} /><Txt kind="small" style={{ color: t.ok }}>Sent</Txt></Row>
                    : <Icon name={on ? 'checkbox' : 'square-outline'} size={24} color={on ? t.ink : t.muted} />}
                </Pressable>
              );
            })}
            {!people.length && <Txt kind="muted" style={{ marginVertical: 12 }}>Choose someone from your contacts, or type their number.</Txt>}
          </ScrollView>

          {typing ? (
            <View style={{ gap: 8 }}>
              <Row>
                <TextInput value={name} onChangeText={setName} placeholder="Name (e.g. Aama)" placeholderTextColor={t.muted} style={[styles.input, { flex: 1, borderColor: t.line, color: t.ink, backgroundColor: t.bg }]} />
                <TextInput value={phone} onChangeText={(v) => setPhone(v.replace(/[^\d+]/g, '').slice(0, 14))} placeholder="98XXXXXXXX" keyboardType="phone-pad" placeholderTextColor={t.muted} style={[styles.input, { flex: 1.2, borderColor: t.line, color: t.ink, backgroundColor: t.bg }]} />
              </Row>
              <Button title="Add" kind="soft" onPress={() => { add({ name: name.trim() || local(phone), phone: local(phone) }); setName(''); setPhone(''); }} disabled={local(phone).length !== 10} />
            </View>
          ) : (
            <Row style={{ gap: 8 }}>
              <Button title="From contacts" icon="people-outline" kind="soft" onPress={fromContacts} style={{ flex: 1 }} />
              <Button title="Type a number" icon="keypad-outline" kind="soft" onPress={() => setTyping(true)} style={{ flex: 1 }} />
            </Row>
          )}

          {!!err && <Row><Icon name="alert-circle" size={16} color={t.danger} /><Txt kind="small" style={{ flex: 1, color: t.danger }}>{err}</Txt></Row>}
          <Button title={busy ? 'Sending…' : picked.length ? `Send to ${picked.length} ${picked.length === 1 ? 'person' : 'people'}` : 'Choose who to send to'} kind="dark" icon="send" onPress={send} disabled={!picked.length || busy} />
          <Pressable onPress={() => Share.share({ message: `Follow my MyRide trip live: ${link}` })} style={styles.more} accessibilityRole="button">
            <Icon name="share-social-outline" size={16} color={t.muted} />
            <Txt kind="small">Or send the link on WhatsApp, Viber or Messenger</Txt>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0006' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, gap: 12 },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  input: { borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15 },
  more: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 4 },
});
