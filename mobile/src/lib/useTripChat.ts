import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState } from 'react';
import { api, type ChatMessage } from './api';
import type { ServerEvent } from './useEvents';

/**
 * Chat state for the current trip: messages (loaded once, then live via `receive` and the screen's slow poll via
 * `refresh`), whether the chat is open, and how many of the other person's messages arrived while it was closed.
 */
export function useTripChat(tripId: string | null | undefined, me: 'rider' | 'driver') {
  const [state, setState] = useState<{ tripId: string | null; list: ChatMessage[]; unread: number }>({ tripId: null, list: [], unread: 0 });
  const [visible, setVisible] = useState(false);
  const current = state.tripId === tripId ? state : { tripId: tripId ?? null, list: [], unread: 0 }; // a new trip starts empty

  // Merge messages in; count the other person's new ones as unread while the chat is closed.
  const merge = useCallback((incoming: ChatMessage[], id: string) => {
    setState((old) => {
      const base = old.tripId === id ? old : { tripId: id, list: [], unread: 0 };
      const fresh = incoming.filter((m) => !base.list.some((x) => x.id === m.id));
      if (!fresh.length) return base;
      const theirs = fresh.filter((m) => m.from !== me).length;
      return { tripId: id, list: [...base.list, ...fresh].sort((a, b) => a.at - b.at), unread: base.unread + (visible ? 0 : theirs) };
    });
  }, [me, visible]);

  const refresh = useCallback(async () => {
    if (!tripId) return;
    merge(await api<ChatMessage[]>('GET', `/api/trips/${tripId}/messages`), tripId);
  }, [tripId, merge]);
  useEffect(() => {
    if (!tripId) return;
    api<ChatMessage[]>('GET', `/api/trips/${tripId}/messages`).then((l) => merge(l, tripId)).catch(() => {});
  }, [tripId, merge]);

  /** Feed live server events here (from the screen's useEvents). */
  const receive = (e: ServerEvent) => {
    if (e.type !== 'message' || !tripId || e.tripId !== tripId || !e.message) return false;
    merge([e.message], tripId);
    if (!visible) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    return true;
  };

  return {
    messages: current.list,
    unread: visible ? 0 : current.unread,
    visible,
    open: () => { setVisible(true); setState((old) => ({ ...old, unread: 0 })); },
    close: () => setVisible(false),
    sent: (m: ChatMessage) => tripId && merge([m], tripId),
    receive,
    refresh,
  };
}
