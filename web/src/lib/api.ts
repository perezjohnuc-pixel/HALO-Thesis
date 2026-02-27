import type { PaymentProvider } from "./types";
import { auth } from "./firebase";

// If you run the Vite dev server (5173), it cannot use Hosting rewrites.
// Set VITE_API_BASE to your Functions emulator or deployed region base.
// - Emulator: http://localhost:5001/<PROJECT_ID>/asia-east2
// - Deployed: https://asia-east2-<PROJECT_ID>.cloudfunctions.net
const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

const DEVICE_KEY_STORAGE = "HALO_DEVICE_KEY";

export function getDeviceKey() {
  return localStorage.getItem(DEVICE_KEY_STORAGE) || "";
}

export function setDeviceKey(v: string) {
  localStorage.setItem(DEVICE_KEY_STORAGE, v);
}

async function postJson<T>(path: string, body: any): Promise<T> {
  const key = getDeviceKey();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-halo-device-key": key,
    },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) ? `${data.message || data.error}` : `HTTP_${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

async function postJsonAsUser<T>(path: string, body: any): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("You must be signed in.");

  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body ?? {}),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) ? `${data.message || data.error}` : `HTTP_${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export function deviceVerifyQr(input: { bookingId: string; lockerId: string; token: string; deviceId?: string }) {
  return postJson<any>("/api/verify", input);
}

export function deviceConfirmPayment(input: {
  lockerId: string;
  deviceId?: string;
  paymentPayload: string;
  provider?: PaymentProvider;
}) {
  return postJson<any>("/api/confirmPayment", input);
}

export function deviceComplete(input: { lockerId: string; deviceId?: string; success?: boolean }) {
  return postJson<any>("/api/complete", input);
}

// Manual maintenance (Spark-friendly demos)
export function expireNow() {
  return postJson<any>("/api/expireNow", {});
}

export function userCompleteBooking(input: { bookingId: string; selectedModes: string[]; sequenceName: string }) {
  return postJsonAsUser<any>("/api/user/complete", input);
}

const api = {
  getDeviceKey,
  setDeviceKey,
  deviceVerifyQr,
  deviceConfirmPayment,
  deviceComplete,
  expireNow,
  userCompleteBooking,
};

export default api;
