import { apiUrl } from './config';

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, message: string, body: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

let token: string | null = null;
export const setApiToken = (t: string | null) => { token = t; };
export const getApiToken = () => token;

export async function api<T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${apiUrl()}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (json as { error?: string }).error || `Request failed (${res.status})`, json);
  return json as T;
}

/** Absolute URL on the MyRide server (share links, web pages opened in-app). */
export const apiUrlFor = (path: string) => `${apiUrl()}${path}`;

export const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-IN')}`;

// ---- shared shapes returned by the MyRide API ----
export type Point = { lat: number; lng: number; label?: string };
export type Quote = {
  service: string; label: string; total: number; gross: number; km: number; min: number; available?: number;
  unavailable?: string; legalCap: number | null; intercity?: boolean;
  discounts: { kind: string; label: string; amount: number }[];
  competitors: { name: string; estimate: number }[];
  split: { driver: number; promoCost: number };
};
export type Vehicle = { type: string; fuel: string; plate: string; model: string };
export type Trip = {
  id: string; status: string; service: string; kind: string; logistics?: boolean; fare: number; pin: string; shareToken: string;
  pickup: Point; drop: Point; route: { km: number; min: number; geometry: [number, number][] };
  quote: Quote & { lines: { label: string; amount: number }[] };
  payment: { method: string; status: string };
  driver: null | { name: string; phone: string; rating: number; vehicle: Vehicle; loc: Point | null; fleet?: boolean };
  deliveryOtp?: string; recipient?: { name: string; phone: string }; riderRating?: { stars: number };
  cancellation?: { fee: number; waivedByPlus?: boolean };
};
export type DriverTrip = {
  id: string; status: string; kind: string; logistics?: boolean; service: string; fare: number; earning: number | null; employee: boolean;
  pickup: Point; drop: Point; km: number; min: number; pickupKm: number; deadKmBonus: number; payment: string;
  riderName: string; riderPhone?: string; recipient?: { name: string; phone?: string }; note?: string; offerExpiresAt: number;
  parcel?: { weightKg: number; goodsType?: string; helpers?: number; codAmount?: number; fragile?: boolean };
};
