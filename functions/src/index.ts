import "dotenv/config";
import express from "express";
import cors from "cors";
import * as crypto from "crypto";
import * as admin from "firebase-admin";

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  }),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const db = admin.firestore();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// =========================
// Config
// =========================
const QR_SECRET = process.env.QR_SECRET?.trim() || "dev-secret";
const DEVICE_API_KEY = process.env.DEVICE_API_KEY?.trim() || "dev-device-key";

const PAYMENT_TTL_MS = 2 * 60 * 1000;
const UNLOCK_MS = 5000;

const DEFAULT_UV_SEC = (() => {
  const v = Number(process.env.DEFAULT_UV_SECONDS || 120);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 120;
})();

const DEFAULT_MIST_SEC = (() => {
  const v = Number(process.env.MIST_SECONDS || 120);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 120;
})();

const DEFAULT_DRYER_SEC = (() => {
  const v = Number(process.env.DRYER_SECONDS || 180);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 180;
})();

const PROGRAM_ORDER = ["mist", "dryer", "uvc"] as const;

type BookingStatus =
  | "reserved"
  | "pending_payment"
  | "active"
  | "cancelled"
  | "completed"
  | "expired"
  | "failed";

const BLOCKING = new Set<BookingStatus>(["reserved", "pending_payment", "active"]);

function stepSeconds(step: string): number {
  if (step === "mist") return DEFAULT_MIST_SEC;
  if (step === "dryer") return DEFAULT_DRYER_SEC;
  if (step === "uvc") return DEFAULT_UV_SEC;
  return 0;
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
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

function requireDeviceKey(req: express.Request) {
  const header = (req.get("x-halo-device-key") || "").toString();
  const bearer = (req.get("authorization") || "").toString();
  const token = header || (bearer.startsWith("Bearer ") ? bearer.slice("Bearer ".length) : "");

  if (!token) return { ok: false as const, status: 401, error: "MISSING_DEVICE_KEY" };
  if (token !== DEVICE_API_KEY) return { ok: false as const, status: 403, error: "INVALID_DEVICE_KEY" };

  return { ok: true as const };
}

async function requireUserAuth(req: express.Request) {
  const authHeader = (req.get("authorization") || "").toString();
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";

  if (!token) return { ok: false as const, status: 401, error: "MISSING_AUTH_TOKEN" };

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return { ok: true as const, uid: decoded.uid };
  } catch {
    return { ok: false as const, status: 401, error: "INVALID_AUTH_TOKEN" };
  }
}

// =========================
// Health check
// =========================
app.get("/", (_req, res) => {
  res.status(200).send("HALO Railway backend is running");
});

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/api/device/lockerStatus", async (req, res) => {
  const auth = requireDeviceKey(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }

  try {
    const lockerId = String(req.query.lockerId || "").trim();
    if (!lockerId) {
      return res.status(400).json({ ok: false, error: "MISSING_LOCKER_ID" });
    }

    const lockerRef = db.doc(`lockers/${lockerId}`);
    const lockerSnap = await lockerRef.get();

    if (!lockerSnap.exists) {
      return res.status(404).json({ ok: false, error: "LOCKER_NOT_FOUND" });
    }

    const locker = lockerSnap.data() as any;
    const currentBookingId = locker.currentBookingId ?? null;

    let bookingStatus: string | null = null;
    if (currentBookingId) {
      const bookingRef = db.doc(`bookings/${currentBookingId}`);
      const bookingSnap = await bookingRef.get();
      if (bookingSnap.exists) {
        const booking = bookingSnap.data() as any;
        bookingStatus = booking.status ?? null;
      }
    }

    return res.json({
      ok: true,
      lockerId,
      lockerStatus: locker.status ?? "unknown",
      bookingStatus,
      pendingPayment: !!locker.pendingPayment,
      occupied: !!locker.occupied,
      currentBookingId,
    });
  } catch (err: any) {
    console.error("lockerStatus error", err);
    return res.status(500).json({
      ok: false,
      error: "INTERNAL",
      message: err?.message ?? String(err),
    });
  }
});

// =========================
// Manual expire helper
// =========================
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
        if (!status || !BLOCKING.has(status)) return;

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
      });
    })
  );
}

app.post("/api/expireNow", async (req, res) => {
  const auth = requireDeviceKey(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }

  try {
    await autoExpireCore(200);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("expireNow error", err);
    return res.status(500).json({ ok: false, error: "INTERNAL", message: err?.message ?? String(err) });
  }
});

// =========================
// Device endpoints
// =========================
app.post("/api/verify", async (req, res) => {
  console.log("ENTER /api/verify");

  const auth = requireDeviceKey(req);
  if (!auth.ok) {
    console.log("AUTH FAILED", auth.error);
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }

  const { bookingId, lockerId, token, deviceId } = req.body as {
    bookingId?: string;
    lockerId?: string;
    token?: string;
    deviceId?: string;
  };

  console.log("BODY", {
    bookingId,
    lockerId,
    tokenPresent: !!token,
    deviceId,
  });

  if (!bookingId || !lockerId || !token) {
    console.log("MISSING_FIELDS");
    return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });
  }

  const bookingRef = db.doc(`bookings/${bookingId}`);
  const lockerRef = db.doc(`lockers/${lockerId}`);

  try {
    console.log("BEFORE HASH");
    const expectedHash = sha256Hex(`${token}|${QR_SECRET}`);

    console.log("BEFORE TRANSACTION");
    const result = await db.runTransaction(async (tx) => {
      console.log("INSIDE TRANSACTION START");

      const [bSnap, lSnap] = await Promise.all([tx.get(bookingRef), tx.get(lockerRef)]);

      console.log("AFTER GETS", {
        bookingExists: bSnap.exists,
        lockerExists: lSnap.exists,
      });

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

    console.log("TRANSACTION RESULT", result);

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
    console.error("VERIFY ERROR", err);
    return res.status(500).json({ ok: false, error: "INTERNAL", message: err?.message ?? String(err) });
  }
});

app.post("/api/confirmPayment", async (req, res) => {
  const auth = requireDeviceKey(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }

  const { lockerId, deviceId, paymentPayload, provider } = req.body as {
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

    return res.json({
      ok: true,
      action: "UNLOCK",
      bookingId: (result as any).bookingId,
      unlockMs: (result as any).unlockMs,
      endsAt: (result as any).endsAt,
    });
  } catch (err: any) {
    console.error("confirmPayment error", err);
    return res.status(500).json({ ok: false, error: "INTERNAL", message: err?.message ?? String(err) });
  }
});

app.post("/api/complete", async (req, res) => {
  const auth = requireDeviceKey(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }

  const { lockerId, deviceId, success } = req.body as {
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

      return { ok: true as const, bookingId };
    });

    if (!result.ok) return res.status(400).json(result);
    return res.json({ ok: true, bookingId: (result as any).bookingId });
  } catch (err: any) {
    console.error("complete error", err);
    return res.status(500).json({ ok: false, error: "INTERNAL", message: err?.message ?? String(err) });
  }
});

app.post("/api/user/startProgram", async (req, res) => {
  const auth = await requireUserAuth(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }

  const { bookingId, selectedModes, sequenceName } = req.body as {
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

      return { ok: true as const, lockerId, steps };
    });

    if (!result.ok) return res.status(400).json(result);
    return res.json({ ok: true, lockerId: (result as any).lockerId, steps: (result as any).steps });
  } catch (err: any) {
    console.error("startProgram error", err);
    return res.status(500).json({ ok: false, error: "INTERNAL", message: err?.message ?? String(err) });
  }
});

app.post("/api/user/complete", async (req, res) => {
  const auth = await requireUserAuth(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }

  const { bookingId, selectedModes, sequenceName } = req.body as {
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

      return { ok: true as const, lockerId };
    });

    if (!result.ok) return res.status(400).json(result);
    return res.json({ ok: true, action: "UNLOCKED", lockerId: (result as any).lockerId });
  } catch (err: any) {
    console.error("user complete error", err);
    return res.status(500).json({ ok: false, error: "INTERNAL", message: err?.message ?? String(err) });
  }
});

// =========================
// Server start
// =========================
const port = Number(process.env.PORT) || 3000;

app.listen(port, "0.0.0.0", () => {
  console.log(`HALO backend listening on port ${port}`);
});