import { API_URL } from './config';

export class ApiError extends Error {
  constructor(public status: number, message: string, public data: Record<string, unknown> = {}) { super(message); }
}

let token: string | null = null;
export const setApiToken = (t: string | null) => { token = t; };
export const getApiToken = () => token;

/** Absolute URL on the MyRide server (API calls, share links, web pages opened in-app). */
export const apiUrlFor = (path: string) => `${API_URL}${path}`;

const TIMEOUT_MS = 15000;

export async function api<T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  // Without a timeout an unreachable server leaves screens spinning forever (fetch never settles on some networks).
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(apiUrlFor(path), {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: abort.signal,
    });
  } catch (e) {
    throw new Error(abort.signal.aborted ? "Can't reach MyRide. Check your internet connection." : (e as Error).message);
  } finally {
    clearTimeout(timer);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error || `Request failed (${res.status})`, json);
  return json as T;
}

export const rs = (n: number, decimals = 0) => `Rs ${(decimals ? n : Math.round(n)).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;

// ---- shared shapes returned by the MyRide API ----
export type Point = { lat: number; lng: number; label?: string };
export type Quote = {
  service: string; label: string; total: number; gross: number; km: number; min: number; available?: number;
  pickupMin?: number | null; seats?: number | null; // nearest free driver's minutes to the pickup; passenger seats
  unavailable?: string; legalCap: number | null; intercity?: boolean;
  discounts: { kind: string; label: string; amount: number }[];
  competitors: { name: string; estimate: number }[];
  split: { driver: number; promoCost: number };
};
export type Trip = {
  id: string; status: string; service: string; kind: string; logistics?: boolean; fare: number; pin: string; shareToken: string; scheduledAt?: number | null;
  pickup: Point; drop: Point; route: { km: number; min: number; geometry: [number, number][] };
  quote: Quote & { lines: { label: string; amount: number }[] };
  payment: { method: string; status: string };
  driver: null | { name: string; phone: string; rating: number; vehicle: { type: string; plate: string; model: string }; loc: Point | null; fleet?: boolean };
  deliveryOtp?: string; recipient?: { name: string; phone: string }; riderRating?: { stars: number };
};
/** In-trip chat. `from` uses the server's names: 'rider' = the customer, 'driver' = the person driving. */
export type ChatMessage = { id: string; from: 'rider' | 'driver'; text: string; at: number };
export type DriverTrip = {
  id: string; status: string; kind: string; logistics?: boolean; service: string; fare: number; earning: number | null; employee: boolean;
  pickup: Point; drop: Point; km: number; pickupKm: number; deadKmBonus: number; payment: string;
  riderName: string; riderPhone?: string; recipient?: { name: string; phone?: string }; offerExpiresAt: number;
  parcel?: { weightKg: number; goodsType?: string; codAmount?: number };
};
