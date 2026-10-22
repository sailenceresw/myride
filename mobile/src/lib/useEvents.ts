import { useEffect, useRef } from 'react';
import EventSource from 'react-native-sse';
import { apiUrlFor, getApiToken, type ChatMessage } from './api';

export type ServerEvent = { type: string; role?: 'rider' | 'driver'; status?: string; trip?: any; tripId?: string; message?: ChatMessage };

/**
 * Live server events (offers, trip status, selfie checks) over SSE while `enabled`.
 * Reconnects every 5 s after a drop; screens keep a slow poll as a safety net.
 */
export function useEvents(onEvent: (e: ServerEvent) => void, enabled = true) {
  const ref = useRef(onEvent);
  useEffect(() => { ref.current = onEvent; });
  useEffect(() => {
    const token = getApiToken();
    if (!enabled || !token) return;
    const es = new EventSource(apiUrlFor('/api/events'), { headers: { Authorization: `Bearer ${token}` }, pollingInterval: 5000 });
    es.addEventListener('message', (e) => { try { ref.current(JSON.parse(e.data ?? '')); } catch { /* ping / bad frame */ } });
    return () => { es.removeAllEventListeners(); es.close(); };
  }, [enabled]);
}
