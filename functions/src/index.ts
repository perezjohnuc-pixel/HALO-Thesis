import "dotenv/config";
import { setGlobalOptions } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentUpdated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onRequest } from "firebase-functions/v2/https";
import * as crypto from "crypto";
import * as admin from "firebase-admin";
import cors from "cors";

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ region: "asia-east2" });

// =========================
// Config (no Secret Manager required)
// =========================
// For production, set these as environment variables in Cloud Functions.
// Defaults are for local/testing only.
const QR_SECRET = process.env.QR_SECRET?.trim() || "dev-secret";
const DEVICE_API_KEY = process.env.DEVICE_API_KEY?.trim() || "dev-device-key";

// Fairness timers
// - After RESERVE: user has 3 minutes to scan the QR at the locker.
// - After FIRST SCAN: user has 2 minutes to complete payment.
const SCAN_TTL_MS = 3 * 60 * 1000;
const PAYMENT_TTL_MS = 2 * 60 * 1000;

// Physical unlock pulse (ms). Firmware can ignore / clamp as needed.
const UNLOCK_MS = 5000;

// Default UV-C run time (seconds). Adjust to your design.
const DEFAULT_UV_SEC = (() => {
  const v = Number(process.env.DEFAULT_UV_SECONDS || 120);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 120;
})();

// Sanitation program defaults (seconds). These should mirror the web UI recommended times.
const DEFAULT_MIST_SEC = (() => {
  const v = Number(process.env.MIST_SECONDS || 120);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 120;
})();

const DEFAULT_DRYER_SEC = (() => {
  const v = Number(process.env.DRYER_SECONDS || 180);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 180;
})();

const PROGRAM_ORDER = ["mist", "dryer", "uvc"] as const;

function stepSeconds(step: string): number {
  if (step === "mist") return DEFAULT_MIST_SEC;
  if (step === "dryer") return DEFAULT_DRYER_SEC;
  if (step === "uvc") return DEFAULT_UV_SEC;
  return 0;
}

type BookingStatus =
  | "reserved"
  | "pending_payment"
  | "active"
  | "cancelled"
  | "completed"
  | "expired"
  | "failed";

const BLOCKING = new Set<BookingStatus>(["reserved", "pending_payment", "active"]);

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function randomToken(len = 30) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function safeEq(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function tsPlusMs(ts: admin.firestore.Timestamp, ms: number) {
  return admin.firestore.Timestamp.fromMillis(ts.toMillis() + ms);
}

function requireDeviceKey(req: any): { ok: true } | { ok: false; status: number; error: string } {
  const header = (req.get("x-halo-device-key") || "").toString();
  const bearer = (req.get("authorization") || "").toString();
  const token = header || (bearer.startsWith("Bearer ") ? bearer.slice("Bearer ".length) : "");
  if (!token) return { ok: false, status: 401, error: "MISSING_DEVICE_KEY" };
  if (token !== DEVICE_API_KEY) return { ok: false, status: 403, error: "INVALID_DEVICE_KEY" };
  return { ok: true };
}

async function requireUserAuth(req: any): Promise<{ ok: true; uid: string } | { ok: false; status: number; error: string }> {
  const authHeader = (req.get("authorization") || "").toString();
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!token) return { ok: false, status: 401, error: "MISSING_AUTH_TOKEN" };
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return { ok: true, uid: decoded.uid };
  } catch {
    return { ok: false, status: 401, error: "INVALID_AUTH_TOKEN" };
  }
}

const withCors = cors({ origin: true });

// =====================================================
// 1) Touch lastUpdatedAt for any meaningful booking write
// =====================================================
export const touchBookingLastUpdatedAt = onDocumentWritten("bookings/{bookingId}", async (event) => {
  const after = event.data?.after;
  if (!after?.exists) return;

  const beforeData = (event.data?.before?.data() || {}) as Record<string, unknown>;
  const afterData = after.data() as Record<string, unknown>;

  const keys = new Set<string>([...Object.keys(beforeData), ...Object.keys(afterData)]);
  const changedKeys: string[] = [];

  for (const k of keys) {
    const b = (beforeData as any)[k];
    const a = (afterData as any)[k];
    if (JSON.stringify(b) !== JSON.stringify(a)) changedKeys.push(k);
  }

  if (changedKeys.length === 1 && changedKeys[0] === "lastUpdatedAt") return;

  await after.ref.set({ lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
});

// =======================================
// 2) On booking creation: mint QR + reserve locker
// =======================================
export const onBookingCreated = onDocumentWritten("bookings/{bookingId}", async (event) => {
  const beforeExists = event.data?.before?.exists;
  const after = event.data?.after;
  if (beforeExists || !after?.exists) return;

  const bookingId = event.params.bookingId as string;
  const b = after.data() as any;

  const lockerId = b?.lockerId as string | undefined;
  const userId = b?.userId as string | undefined;
  const status = b?.status as BookingStatus | undefined;

  // Only initialize reserved bookings created by clients
  if (!lockerId || !userId || status !== "reserved") return;

  const bookingRef = after.ref;
  const lockerRef = db.doc(`lockers/${lockerId}`);

  const now = admin.firestore.Timestamp.now();
  const fallbackToken = randomToken(30);
  const qrExpiresAt = tsPlusMs(now, SCAN_TTL_MS);
  const holdExpiresAt = qrExpiresAt;

  await db.runTransaction(async (tx) => {
    const [bSnap, lSnap] = await Promise.all([tx.get(bookingRef), tx.get(lockerRef)]);
    if (!bSnap.exists) return;

    const booking = bSnap.data() as any;

    const existingQrToken = typeof booking.qrToken === "string" ? booking.qrToken : undefined;
    const qrToken = existingQrToken || fallbackToken;
    const qrTokenHash = sha256Hex(`${qrToken}|${QR_SECRET}`);

    // Idempotent: do nothing if already fully initialized
    if (booking.qrToken && booking.qrTokenHash && booking.qrExpiresAt && booking.holdExpiresAt) return;

    if (!lSnap.exists) {
      tx.update(bookingRef, {
        status: "failed",
        failReason: "LOCKER_NOT_FOUND",
        failedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return;
    }

    const locker = lSnap.data() as any;

    // If locker is currently owned by a different booking, fail this booking.
    if (locker.currentBookingId && locker.currentBookingId !== bookingId && locker.occupied === true) {
      tx.update(bookingRef, {
        status: "failed",
        failReason: "LOCKER_BUSY",
        failedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return;
    }

    tx.update(bookingRef, {
      qrToken,
      qrTokenHash,
      qrExpiresAt,
      holdExpiresAt,
    });

    // Reserve the locker immediately.
    tx.set(
      lockerRef,
      {
        status: "reserved",
        occupied: true,
        currentBookingId: bookingId,
        reservedByUserId: userId,
        pendingPayment: false,
        reservationExpiresAt: qrExpiresAt,
      },
      { merge: true }
    );

    tx.set(db.collection("logs").doc(), {
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      type: "BOOKING_CREATED",
      message: "Booking created. QR generated automatically (3-minute scan window).",
      lockerId,
      userId,
      payload: { bookingId },
    });
  });
});

// =======================================
// 3) When booking stops blocking, release locker
// =======================================
export const onBookingUpdate = onDocumentUpdated("bookings/{bookingId}", async (event) => {
  const bookingId = event.params.bookingId as string;
  const before = event.data?.before.data() as any;
  const after = event.data?.after.data() as any;

  if (!after?.lockerId) return;

  const beforeStatus = before?.status as BookingStatus | undefined;
  const afterStatus = after?.status as BookingStatus | undefined;
  if (!beforeStatus || !afterStatus) return;

  const wasBlocking = BLOCKING.has(beforeStatus);
  const isBlocking = BLOCKING.has(afterStatus);

  if (wasBlocking && !isBlocking) {
    const lockerRef = db.doc(`lockers/${after.lockerId}`);

    await db.runTransaction(async (tx) => {
      const lockerSnap = await tx.get(lockerRef);
      if (!lockerSnap.exists) return;

      const locker = lockerSnap.data() as any;
      if (locker.currentBookingId !== bookingId) return;

      tx.update(lockerRef, {
        status: "available",
        occupied: false,
        currentBookingId: null,
        reservedByUserId: null,
        pendingPayment: false,
        reservationExpiresAt: null,
        pendingPaymentExpiresAt: null,
      });
    });
  }
});

// =======================================
// 3a) Log booking status transitions (helps admin timeline)
// =======================================
export const logBookingStatusTransitions = onDocumentUpdated("bookings/{bookingId}", async (event) => {
  const bookingId = event.params.bookingId as string;
  const before = event.data?.before.data() as any;
  const after = event.data?.after.data() as any;

  const beforeStatus = before?.status as BookingStatus | undefined;
  const afterStatus = after?.status as BookingStatus | undefined;
  if (!beforeStatus || !afterStatus) return;
  if (beforeStatus === afterStatus) return;

  const lockerId = after?.lockerId ?? before?.lockerId ?? null;
  const userId = after?.userId ?? before?.userId ?? null;

  await db.collection("logs").doc().set({
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    type: "BOOKING_STATUS_CHANGED",
    message: `Booking status changed from ${beforeStatus} to ${afterStatus}.`,
    lockerId,
    userId,
    payload: { bookingId, from: beforeStatus, to: afterStatus },
  });
});

// =======================================
// 3b) If client cancels, attach timestamps
// =======================================
export const onBookingCancelledFillTimestamps = onDocumentUpdated(
  "bookings/{bookingId}",
  async (event) => {
    const before = event.data?.before.data() as any;
    const after = event.data?.after.data() as any;

    const beforeStatus = before?.status as BookingStatus | undefined;
    const afterStatus = after?.status as BookingStatus | undefined;
    if (beforeStatus === afterStatus) return;
    if (afterStatus !== "cancelled") return;

    // Idempotent: only fill if missing
    if (after?.cancelledAt && after?.endAt) return;

    await event.data?.after.ref.set(
      {
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        endAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
);

// =======================================
// 4) AUTO-EXPIRE bookings (every 1 minute)
// =======================================
async function autoExpireCore(limit = 50) {
  const now = admin.firestore.Timestamp.now();
  const LIMIT = limit;

  const pendingSnap = await db
    .collection("bookings")
    .where("status", "==", "pending_payment")
    .where("holdExpiresAt", "<=", now)
    .orderBy("holdExpiresAt", "asc")
    .limit(LIMIT)
    .get();

  const reservedSnap = await db
    .collection("bookings")
    .where("status", "==", "reserved")
    .where("holdExpiresAt", "<=", now)
    .orderBy("holdExpiresAt", "asc")
    .limit(LIMIT)
    .get();

  const activeSnap = await db
    .collection("bookings")
    .where("status", "==", "active")
    .where("endAt", "<=", now)
    .orderBy("endAt", "asc")
    .limit(LIMIT)
    .get();

  const candidates = [...pendingSnap.docs, ...reservedSnap.docs, ...activeSnap.docs];
  await Promise.all(
    candidates.map(async (d) => {
      const bookingId = d.id;
      const bookingRef = db.doc(`bookings/${bookingId}`);

      await db.runTransaction(async (tx) => {
        const bSnap = await tx.get(bookingRef);
        if (!bSnap.exists) return;
        const b = bSnap.data() as any;

        const status = b.status as BookingStatus | undefined;
        if (!status) return;
        if (!BLOCKING.has(status)) return;

        tx.update(bookingRef, {
          status: "expired",
          expiredAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        const lockerId = b.lockerId as string | undefined;
        if (!lockerId) return;
        const lockerRef = db.doc(`lockers/${lockerId}`);
        const lSnap = await tx.get(lockerRef);
        if (!lSnap.exists) return;
        const locker = lSnap.data() as any;
        if (locker.currentBookingId !== bookingId) return;

        tx.update(lockerRef, {
          status: "available",
          occupied: false,
          currentBookingId: null,
          reservedByUserId: null,
          pendingPayment: false,
          reservationExpiresAt: null,
          pendingPaymentExpiresAt: null,
        });

        tx.set(db.collection("logs").doc(), {
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          type: "BOOKING_EXPIRED",
          message: "Booking expired (scan/payment/session window elapsed). Locker released.",
          lockerId,
          userId: b.userId ?? null,
          payload: { bookingId, prevStatus: status },
        });
      });
    })
  );
}

export const autoExpireBookings = onSchedule("every 1 minutes", async () => {
  await autoExpireCore(50);
});

// Spark-friendly manual trigger for demos (Admin can call via Postman/Script)
export const expireNow = onRequest(async (req, res): Promise<void> => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, x-halo-device-key");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
    return;
  }
  const auth = requireDeviceKey(req);
  if (!auth.ok) {
    res.status(auth.status).json({ ok: false, error: auth.error });
    return;
  }
  try {
    await autoExpireCore(200);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: "INTERNAL", message: err?.message ?? String(err) });
  }
});

// =======================================
// 5) RECONCILE lockers (fix stuck occupied) every 5 minutes
// =======================================
export const reconcileLockers = onSchedule("every 5 minutes", async () => {
  const snap = await db.collection("lockers").where("occupied", "==", true).limit(100).get();
  if (snap.empty) return;

  await Promise.all(
    snap.docs.map(async (doc) => {
      const locker = doc.data() as any;
      const bookingId = locker.currentBookingId as string | undefined;
      if (!bookingId) return;

      const bookingRef = db.doc(`bookings/${bookingId}`);
      const bSnap = await bookingRef.get();
      if (!bSnap.exists) {
        // Orphaned locker
        await doc.ref.update({
          status: "available",
          occupied: false,
          currentBookingId: null,
          reservedByUserId: null,
          pendingPayment: false,
          reservationExpiresAt: null,
          pendingPaymentExpiresAt: null,
        });
        return;
      }

      const booking = bSnap.data() as any;
      const status = booking.status as BookingStatus | undefined;
      if (!status || !BLOCKING.has(status)) {
        await doc.ref.update({
          status: "available",
          occupied: false,
          currentBookingId: null,
          reservedByUserId: null,
          pendingPayment: false,
          reservationExpiresAt: null,
          pendingPaymentExpiresAt: null,
        });
      }
    })
  );
});

// =======================================
// Device endpoints
// =======================================

/**
 * QR verify endpoint (device -> backend)
 * First scan:
 *  - Validates the QR token.
 *  - Marks booking as pending_payment (2-minute window).
 *  - Returns UNLOCK command.
 */
export const verifyQrAndUnlock = onRequest(async (req, res) => {
  return withCors(req, res, async () => {
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

    const auth = requireDeviceKey(req);
    if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });

    const { bookingId, lockerId, token, deviceId } = (req.body ?? {}) as {
      bookingId?: string;
      lockerId?: string;
      token?: string;
      deviceId?: string;
    };

    if (!bookingId || !lockerId || !token) {
      return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });
    }

    const bookingRef = db.doc(`bookings/${bookingId}`);
    const lockerRef = db.doc(`lockers/${lockerId}`);

    try {
      const expectedHash = sha256Hex(`${token}|${QR_SECRET}`);

      const result = await db.runTransaction(async (tx) => {
        const [bSnap, lSnap] = await Promise.all([tx.get(bookingRef), tx.get(lockerRef)]);
        if (!bSnap.exists) return { ok: false as const, error: "BOOKING_NOT_FOUND" };
        if (!lSnap.exists) return { ok: false as const, error: "LOCKER_NOT_FOUND" };

        const booking = bSnap.data() as any;
        const locker = lSnap.data() as any;

        if (booking.lockerId !== lockerId) return { ok: false as const, error: "LOCKER_MISMATCH" };

        const status = booking.status as BookingStatus | undefined;
        if (!status) return { ok: false as const, error: "INVALID_BOOKING" };

        if (status === "pending_payment") {
          return { ok: true as const, already: "AWAITING_PAYMENT" as const };
        }
        if (status !== "reserved") return { ok: false as const, error: "BOOKING_NOT_UNLOCKABLE" };

        const expiresAt = booking.qrExpiresAt?.toMillis?.() as number | undefined;
        if (!expiresAt) return { ok: false as const, error: "QR_NOT_READY" };
        if (Date.now() > expiresAt) return { ok: false as const, error: "TOKEN_EXPIRED" };

        const qrHash = booking.qrTokenHash as string | undefined;
        if (qrHash && !safeEq(qrHash, expectedHash)) return { ok: false as const, error: "INVALID_TOKEN" };

        // Make sure locker isn't owned by a different booking
        if (locker.currentBookingId && locker.currentBookingId !== bookingId) {
          return { ok: false as const, error: "LOCKER_OWNED_BY_OTHER_BOOKING" };
        }

        const now = admin.firestore.Timestamp.now();
        const payDeadline = tsPlusMs(now, PAYMENT_TTL_MS);

        tx.update(bookingRef, {
          status: "pending_payment",
          paymentRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
          holdExpiresAt: payDeadline,
          qrUsedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        tx.update(lockerRef, {
          status: "pending_payment",
          occupied: true,
          currentBookingId: bookingId,
          pendingPayment: true,
          pendingPaymentExpiresAt: payDeadline,
        });

        tx.set(db.collection("logs").doc(), {
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          type: "QR_SCANNED",
          message: "QR scanned and validated. Payment required within 2 minutes.",
          lockerId,
          userId: booking.userId ?? null,
          payload: { bookingId, deviceId: deviceId ?? null },
        });

        return { ok: true as const, paymentWindowSec: Math.ceil(PAYMENT_TTL_MS / 1000) };
      });

      if (!result.ok) return res.status(400).json(result);

      if ((result as any).already === "AWAITING_PAYMENT") {
        return res.json({ ok: true, action: "AWAIT_PAYMENT", paymentWindowSec: Math.ceil(PAYMENT_TTL_MS / 1000) });
      }

      return res.json({
        ok: true,
        action: "PAYMENT_REQUIRED",
        paymentWindowSec: (result as any).paymentWindowSec ?? Math.ceil(PAYMENT_TTL_MS / 1000),
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: "INTERNAL", message: err?.message ?? String(err) });
    }
  });
});

/**
 * Payment confirmation endpoint (device -> backend)
 * After payment:
 *  - Backend marks booking ACTIVE and sets endAt based on durationMin.
 *  - Backend queues an UNLOCK command.
 *  - Sanitation program is started by the user (authenticated) via /api/user/startProgram.
 */
export const confirmPaymentAndStartDisinfection = onRequest(async (req, res) => {
  return withCors(req, res, async () => {
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

    const auth = requireDeviceKey(req);
    if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });

    const { lockerId, deviceId, paymentPayload, provider } = (req.body ?? {}) as {
      lockerId?: string;
      deviceId?: string;
      paymentPayload?: string;
      provider?: string;
    };

    if (!lockerId || !paymentPayload) {
      return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });
    }

    const lockerRef = db.doc(`lockers/${lockerId}`);

    try {
      const result = await db.runTransaction(async (tx) => {
        const lSnap = await tx.get(lockerRef);
        if (!lSnap.exists) return { ok: false as const, error: "LOCKER_NOT_FOUND" };

        const locker = lSnap.data() as any;
        const bookingId = locker.currentBookingId as string | undefined;
        if (!bookingId) return { ok: false as const, error: "NO_ACTIVE_BOOKING" };

        const bookingRef = db.doc(`bookings/${bookingId}`);
        const bSnap = await tx.get(bookingRef);
        if (!bSnap.exists) return { ok: false as const, error: "BOOKING_NOT_FOUND" };

        const booking = bSnap.data() as any;
        const status = booking.status as BookingStatus | undefined;
        if (status !== "pending_payment") return { ok: false as const, error: "NOT_AWAITING_PAYMENT" };

        const holdMs = booking.holdExpiresAt?.toMillis?.() as number | undefined;
        if (typeof holdMs !== "number" || Date.now() > holdMs) {
          // Payment window expired -> expire booking and release locker
          tx.update(bookingRef, { status: "expired", expiredAt: admin.firestore.FieldValue.serverTimestamp() });
          tx.update(lockerRef, {
            status: "available",
            occupied: false,
            currentBookingId: null,
            reservedByUserId: null,
            pendingPayment: false,
            reservationExpiresAt: null,
            pendingPaymentExpiresAt: null,
          });
          return { ok: false as const, error: "PAYMENT_WINDOW_EXPIRED" };
        }

        const now = admin.firestore.Timestamp.now();
        const durationMin = Number(booking.durationMin ?? 3);
        const endAt = tsPlusMs(now, Math.max(1, durationMin) * 60 * 1000);

        // Record payment (simulation-friendly)
        const payRef = db.collection("payments").doc();
        tx.set(payRef, {
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          userId: booking.userId ?? null,
          bookingId,
          lockerId,
          provider: provider ?? "unknown",
          rawPayload: paymentPayload,
          status: "paid",
          deviceId: deviceId ?? null,
        });

        tx.update(bookingRef, {
          status: "active",
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          paymentId: payRef.id,
          holdExpiresAt: null,
          activeAt: admin.firestore.FieldValue.serverTimestamp(),
          endAt,
        });

        tx.update(lockerRef, {
          status: "active",
          pendingPayment: false,
          pendingPaymentExpiresAt: null,
          lastPaymentAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        tx.set(db.collection("logs").doc(), {
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          type: "PAYMENT_CONFIRMED",
          message: "Payment confirmed. Locker will unlock; user may start sanitation program.",
          lockerId,
          userId: booking.userId ?? null,
          payload: { bookingId, paymentId: payRef.id, provider: provider ?? "unknown" },
        });

        // Device command: unlock the locker after payment.
        tx.set(db.collection("deviceCommands").doc(), {
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          lockerId,
          type: "unlock",
          status: "queued",
          payload: { durationMs: UNLOCK_MS, reason: "payment_confirmed", bookingId },
        });

        return { ok: true as const, bookingId, unlockMs: UNLOCK_MS, endsAt: endAt.toMillis() };
      });

      if (!result.ok) return res.status(400).json(result);
      return res.json({ ok: true, action: "UNLOCK", bookingId: (result as any).bookingId, unlockMs: (result as any).unlockMs, endsAt: (result as any).endsAt });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: "INTERNAL", message: err?.message ?? String(err) });
    }
  });
});

/**
 * Device completes session:
 * - Marks booking completed and releases locker.
 */
export const completeBookingAndReleaseLocker = onRequest(async (req, res) => {
  return withCors(req, res, async () => {
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

    const auth = requireDeviceKey(req);
    if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });

    const { lockerId, deviceId, success } = (req.body ?? {}) as {
      lockerId?: string;
      deviceId?: string;
      success?: boolean;
    };

    if (!lockerId) return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });

    const lockerRef = db.doc(`lockers/${lockerId}`);

    try {
      const result = await db.runTransaction(async (tx) => {
        const lSnap = await tx.get(lockerRef);
        if (!lSnap.exists) return { ok: false as const, error: "LOCKER_NOT_FOUND" };

        const locker = lSnap.data() as any;
        const bookingId = locker.currentBookingId as string | undefined;
        if (!bookingId) return { ok: false as const, error: "NO_ACTIVE_BOOKING" };

        const bookingRef = db.doc(`bookings/${bookingId}`);
        const bSnap = await tx.get(bookingRef);
        if (!bSnap.exists) return { ok: false as const, error: "BOOKING_NOT_FOUND" };

        const booking = bSnap.data() as any;

        tx.update(bookingRef, {
          status: "completed",
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          completedByDeviceId: deviceId ?? null,
          disinfectionOk: success ?? true,
        });

        tx.update(lockerRef, {
          status: "available",
          occupied: false,
          currentBookingId: null,
          reservedByUserId: null,
          pendingPayment: false,
          reservationExpiresAt: null,
          pendingPaymentExpiresAt: null,
          lastDisinfectionAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        tx.set(db.collection("logs").doc(), {
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          type: "BOOKING_COMPLETED",
          message: "Session completed and locker released.",
          lockerId,
          userId: booking.userId ?? null,
          payload: { bookingId, deviceId: deviceId ?? null, success: success ?? true },
        });

        return { ok: true as const, bookingId };
      });

      if (!result.ok) return res.status(400).json(result);
      return res.json({ ok: true, bookingId: (result as any).bookingId });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: "INTERNAL", message: err?.message ?? String(err) });
    }
  });
});

/**
 * User starts sanitation program (mobile/web app):
 * - Validates booking ownership and ACTIVE state
 * - Writes a deviceCommands doc with ordered program steps (Mist → Dryer → UV‑C)
 * - Persists selectedModes/sequenceName onto the booking for audit/logging
 */
export const userStartProgram = onRequest(async (req, res) => {
  return withCors(req, res, async () => {
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

    const auth = await requireUserAuth(req);
    if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });

    const { bookingId, selectedModes, sequenceName } = (req.body ?? {}) as {
      bookingId?: string;
      selectedModes?: string[];
      sequenceName?: string;
    };

    if (!bookingId) return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });

    const chosen = Array.isArray(selectedModes) ? selectedModes.map((s) => String(s)) : [];
    const allowed = new Set(PROGRAM_ORDER);
    const unique = Array.from(new Set(chosen.filter((m) => allowed.has(m as any))));
    const ordered = PROGRAM_ORDER.filter((m) => unique.includes(m));
    if (ordered.length === 0) return res.status(400).json({ ok: false, error: "NO_VALID_MODES" });

    const bookingRef = db.doc(`bookings/${bookingId}`);

    try {
      const result = await db.runTransaction(async (tx) => {
        const bSnap = await tx.get(bookingRef);
        if (!bSnap.exists) return { ok: false as const, error: "BOOKING_NOT_FOUND" };

        const booking = bSnap.data() as any;
        if (booking.userId !== auth.uid) return { ok: false as const, error: "FORBIDDEN" };
        if (booking.status !== "active") return { ok: false as const, error: "BOOKING_NOT_ACTIVE" };

        const lockerId = booking.lockerId as string | undefined;
        if (!lockerId) return { ok: false as const, error: "INVALID_BOOKING" };

        // Idempotent: one program doc per booking.
        const cmdRef = db.collection("deviceCommands").doc(`program_${bookingId}`);

        const steps = ordered.map((id, idx) => ({
          id,
          order: idx,
          seconds: stepSeconds(id),
        }));

        tx.set(
          cmdRef,
          {
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            lockerId,
            type: "sanitation_program",
            status: "queued",
            payload: {
              bookingId,
              sequenceName: sequenceName ?? "custom",
              steps,
            },
          },
          { merge: true }
        );

        tx.update(bookingRef, {
          selectedModes: ordered,
          sequenceName: sequenceName ?? "custom",
          sanitationRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        tx.set(db.collection("logs").doc(), {
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          type: "SANITATION_PROGRAM_REQUESTED",
          message: `Sanitation program requested (${ordered.join(" → ")}).`,
          lockerId,
          userId: auth.uid,
          payload: { bookingId, selectedModes: ordered, sequenceName: sequenceName ?? "custom" },
        });

        return { ok: true as const, lockerId, steps };
      });

      if (!result.ok) return res.status(400).json(result);
      return res.json({ ok: true, lockerId: (result as any).lockerId, steps: (result as any).steps });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: "INTERNAL", message: err?.message ?? String(err) });
    }
  });
});

/**
 * User-initiated finish endpoint (mobile/web app):
 * - User picks sanitation mode(s) and taps Unlock from their app.
 * - Endpoint validates booking ownership and active state.
 * - Marks booking completed and releases locker for next user.
 */
export const userCompleteBooking = onRequest(async (req, res) => {
  return withCors(req, res, async () => {
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

    const auth = await requireUserAuth(req);
    if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });

    const { bookingId, selectedModes, sequenceName } = (req.body ?? {}) as {
      bookingId?: string;
      selectedModes?: string[];
      sequenceName?: string;
    };

    if (!bookingId) return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });

    const bookingRef = db.doc(`bookings/${bookingId}`);

    try {
      const result = await db.runTransaction(async (tx) => {
        const bSnap = await tx.get(bookingRef);
        if (!bSnap.exists) return { ok: false as const, error: "BOOKING_NOT_FOUND" };

        const booking = bSnap.data() as any;
        if (booking.userId !== auth.uid) return { ok: false as const, error: "FORBIDDEN" };
        if (booking.status !== "active") return { ok: false as const, error: "BOOKING_NOT_ACTIVE" };

        const lockerId = booking.lockerId as string | undefined;
        if (!lockerId) return { ok: false as const, error: "INVALID_BOOKING" };

        const lockerRef = db.doc(`lockers/${lockerId}`);
        const lSnap = await tx.get(lockerRef);
        if (!lSnap.exists) return { ok: false as const, error: "LOCKER_NOT_FOUND" };

        tx.update(bookingRef, {
          status: "completed",
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          completedByUserId: auth.uid,
          selectedModes: Array.isArray(selectedModes) ? selectedModes : [],
          sequenceName: sequenceName ?? "custom",
        });

        // Device command: unlock so the user can retrieve items.
        tx.set(
          db.collection("deviceCommands").doc(`unlock_user_${bookingId}`),
          {
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            lockerId,
            type: "unlock",
            status: "queued",
            payload: { durationMs: UNLOCK_MS, reason: "user_complete", bookingId },
          },
          { merge: true }
        );

        tx.update(lockerRef, {
          status: "available",
          occupied: false,
          currentBookingId: null,
          reservedByUserId: null,
          pendingPayment: false,
          reservationExpiresAt: null,
          pendingPaymentExpiresAt: null,
          lastDisinfectionAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        tx.set(db.collection("logs").doc(), {
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          type: "USER_UNLOCKED_LOCKER",
          message: "User completed sanitation flow and unlocked the locker from the app.",
          lockerId,
          userId: auth.uid,
          payload: {
            bookingId,
            selectedModes: Array.isArray(selectedModes) ? selectedModes : [],
            sequenceName: sequenceName ?? "custom",
          },
        });

        return { ok: true as const, lockerId };
      });

      if (!result.ok) return res.status(400).json(result);
      return res.json({ ok: true, action: "UNLOCKED", lockerId: (result as any).lockerId });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: "INTERNAL", message: err?.message ?? String(err) });
    }
  });
});
