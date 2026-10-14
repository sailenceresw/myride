// Expo push notifications (https://docs.expo.dev/push-notifications/sending-notifications/) for when an app is
// backgrounded or closed. Live apps get the same events over SSE, so a push is only sent when the user has no
// open event stream. Optional env: EXPO_ACCESS_TOKEN (only if "enhanced push security" is on in the Expo project).

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const TOKEN_RE = /^Expo(nent)?PushToken\[[\w-]+\]$/;

// What each status means to the person being notified. `url` is the screen the app opens when tapped.
const RIDER = {
  accepted: ['Driver on the way', (t) => `${t.driver?.name ?? 'Your driver'} · ${t.driver?.vehicle?.plate ?? ''}`],
  arrived: ['Your driver has arrived', (t) => `Meet at ${t.pickup.label}. Your PIN is ${t.pin}`],
  completed: ['You have arrived', (t) => (t.fare ? `Fare Rs ${t.fare}. Rate your trip` : 'Free ride! Rate your trip')],
  cancelled: ['Trip cancelled', () => 'Book again any time'],
  no_driver: ['No drivers available', () => 'Please try again in a few minutes'],
};
const DRIVER = { cancelled: ['Trip cancelled', (t) => `${t.riderName} cancelled the trip`] };

/** Map one bus message to a notification for its recipient, or null if it isn't worth a push. */
function notificationFor(msg) {
  if (msg.type === 'offer') return { portal: 'driver', title: 'New trip request', body: `${msg.trip.pickup.label} → ${msg.trip.drop.label} · ${msg.trip.pickupKm} km away`, url: '/driver' };
  if (msg.type === 'face_check' && msg.status === 'required') return { portal: 'driver', title: 'Selfie check required', body: 'Take a quick selfie to keep receiving trips', url: '/driver/selfie' };
  if (msg.type !== 'trip') return null;
  const n = (msg.role === 'driver' ? DRIVER : RIDER)[msg.trip.status];
  return n && { portal: msg.role, title: n[0], body: n[1](msg.trip), url: msg.role === 'driver' ? '/driver' : '/rider' };
}

function createPush({ store, fetchImpl = fetch, log = console.error }) {
  const lastStatus = new Map(); // `${userId}:${tripId}` → status already notified (trip events repeat on every GPS update)

  async function send(user, n) {
    const tokens = (user.pushTokens || []).filter((p) => p.portal === n.portal).map((p) => p.token);
    if (!tokens.length) return;
    const res = await fetchImpl(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}) },
      body: JSON.stringify(tokens.map((to) => ({ to, title: n.title, body: n.body, data: { url: n.url }, sound: 'default', priority: 'high', channelId: 'trips' }))),
      signal: AbortSignal.timeout(8000),
    });
    const tickets = (await res.json().catch(() => ({}))).data || [];
    // Uninstalled apps: forget the token so we stop sending to it.
    const dead = new Set(tickets.map((t, i) => t.details?.error === 'DeviceNotRegistered' && tokens[i]).filter(Boolean));
    if (dead.size) { user.pushTokens = user.pushTokens.filter((p) => !dead.has(p.token)); store.save(); }
  }

  return {
    TOKEN_RE,
    /** Called by the bus for messages nobody is listening to live. */
    deliver(userId, msg) {
      const user = store.get('users', userId);
      const n = user?.pushTokens?.length && notificationFor(msg);
      if (!n) return;
      if (msg.type === 'trip') {
        const key = `${userId}:${msg.trip.id}`;
        if (lastStatus.get(key) === msg.trip.status) return;
        lastStatus.set(key, msg.trip.status);
        if (lastStatus.size > 5000) lastStatus.delete(lastStatus.keys().next().value); // oldest first
      }
      send(user, n).catch((e) => log('push', e.message));
    },
    register(user, token, portal) {
      if (!TOKEN_RE.test(token || '')) return false;
      user.pushTokens = [...(user.pushTokens || []).filter((p) => p.token !== token), { token, portal, at: Date.now() }].slice(-5);
      store.save();
      return true;
    },
    unregister(user, token) {
      user.pushTokens = (user.pushTokens || []).filter((p) => p.token !== token);
      store.save();
    },
  };
}

module.exports = { createPush, notificationFor };
