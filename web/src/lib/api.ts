import type { PaymentProvider } from "./types";
import { auth } from "./firebase";

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
    const msg =
      data && (data.message || data.error)
        ? `${data.message || data.error}`
        : `HTTP_${res.status}`;
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
    const msg =
      data && (data.message || data.error)
        ? `${data.message || data.error}`
        : `HTTP_${res.status}`;
    throw new Error(msg);
  }

  return data as T;
}

export function deviceConfirmPayment(input: {
  lockerId: string;
  deviceId?: string;
  paymentPayload: string;
  provider?: PaymentProvider;
  amountPaid?: number;
}) {
  return postJson<any>("/api/confirmPayment", input);
}

export function deviceSensorStatus(input: {
  lockerId: string;
  bookingId?: string;
  deviceId?: string;
  helmetDetected: boolean;
  doorClosed: boolean;
}) {
  return postJson<any>("/api/device/sensorStatus", input);
}

export function deviceProgramProgress(input: {
  lockerId: string;
  bookingId: string;
  deviceId?: string;
  programRunId?: string;
  programStep: "mist" | "fan" | "uvc" | "awaiting_payment";
}) {
  return postJson<any>("/api/device/programProgress", input);
}

export function deviceVerifyQr(input: {
  qrPayload?: string;
  bookingId?: string;
  lockerId?: string;
  token?: string;
  type?: "booking" | "retrieval";
  deviceId?: string;
}) {
  return postJson<any>("/api/device/verifyQr", input);
}

export function userStartProgram(input: { bookingId: string }) {
  return postJsonAsUser<any>("/api/user/startProgram", input);
}

export function userRequestPayment(input: { bookingId: string }) {
  return postJsonAsUser<any>("/api/user/requestPayment", input);
}

export function userOpenLocker(input: { bookingId: string }) {
  return postJsonAsUser<any>("/api/user/open", input);
}

export function userCompleteBooking(input: { bookingId: string }) {
  return postJsonAsUser<any>("/api/user/complete", input);
}

export function expireNow() {
  return postJson<any>("/api/expireNow", {});
}

const api = {
  getDeviceKey,
  setDeviceKey,
  deviceConfirmPayment,
  deviceSensorStatus,
  deviceProgramProgress,
  deviceVerifyQr,
  userStartProgram,
  userRequestPayment,
  userOpenLocker,
  userCompleteBooking,
  expireNow,
};

export default api;
