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
app.use(express.json({ limit: "1mb" }));

const DEVICE_API_KEY = process.env.DEVICE_API_KEY?.trim() || "dev-device-key";
const UNLOCK_MS = 5000;

const DEFAULT_MIST_SEC = Number(process.env.MIST_SECONDS || 10);
const DEFAULT_FAN_SEC = Number(
  process.env.FAN_SECONDS || process.env.DRYER_SECONDS || 30
);
const DEFAULT_UV_SEC = Number(process.env.DEFAULT_UV_SECONDS || 30);

type QrPurpose = "booking" | "retrieval";

function tsPlusMs(ts: admin.firestore.Timestamp, ms: number) {
  return admin.firestore.Timestamp.fromMillis(ts.toMillis() + ms);
}

function requireDeviceKey(req: express.Request) {
  const header = (req.get("x-halo-device-key") || "").toString();
  const bearer = (req.get("authorization") || "").toString();

  const token =
    header || (bearer.startsWith("Bearer ") ? bearer.slice("Bearer ".length) : "");

  if (!token) {
    return { ok: false as const, status: 401, error: "MISSING_DEVICE_KEY" };
  }

  if (token !== DEVICE_API_KEY) {
    return { ok: false as const, status: 403, error: "INVALID_DEVICE_KEY" };
  }

  return { ok: true as const };
}

async function requireUserAuth(req: express.Request) {
  const authHeader = (req.get("authorization") || "").toString();
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";

  if (!token) {
    return { ok: false as const, status: 401, error: "MISSING_AUTH_TOKEN" };
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return { ok: true as const, uid: decoded.uid };
  } catch {
    return { ok: false as const, status: 401, error: "INVALID_AUTH_TOKEN" };
  }
}

function parseQrPayload(body: any): {
  type: QrPurpose;
  bookingId?: string;
  lockerId?: string;
  token?: string;
} {
  if (body.qrPayload && typeof body.qrPayload === "string") {
    const raw = body.qrPayload.trim();

    if (raw.startsWith("HALO_BOOK|")) {
      const parts = raw.split("|");
      return {
        type: "booking",
        bookingId: parts[1],
        lockerId: parts[2],
        token: parts[3],
      };
    }

    if (raw.startsWith("HALO_RETRIEVE|")) {
      const parts = raw.split("|");
      return {
        type: "retrieval",
        bookingId: parts[1],
        lockerId: parts[2],
        token: parts[3],
      };
    }

    if (raw.startsWith("HALO|")) {
      const parts = raw.split("|");
      return {
        type: body.type === "booking" ? "booking" : "retrieval",
        bookingId: parts[1],
        lockerId: parts[2],
        token: parts[3],
      };
    }

    const parsed = JSON.parse(raw);

    return {
      type: parsed.type === "booking" ? "booking" : "retrieval",
      bookingId: parsed.bookingId,
      lockerId: parsed.lockerId,
      token: parsed.token,
    };
  }

  return {
    type: body.type === "booking" ? "booking" : "retrieval",
    bookingId: body.bookingId,
    lockerId: body.lockerId,
    token: body.token,
  };
}

function deviceStatusForStep(step: string) {
  if (step === "mist") {
    return { lock: true, mist: true, fan: false, uvc: false };
  }

  if (step === "fan") {
    return { lock: true, mist: false, fan: true, uvc: false };
  }

  if (step === "uvc") {
    return { lock: true, mist: false, fan: false, uvc: true };
  }

  if (step === "open") {
    return { lock: false, mist: false, fan: false, uvc: false };
  }

  return { lock: true, mist: false, fan: false, uvc: false };
}

function stepSeconds(step: string) {
  if (step === "mist") return DEFAULT_MIST_SEC;
  if (step === "fan") return DEFAULT_FAN_SEC;
  if (step === "uvc") return DEFAULT_UV_SEC;
  return 0;
}

function amountForService(serviceType: string) {
  if (serviceType === "combined") return 30;
  return 25;
}

function selectedModesForService(serviceType: string) {
  if (serviceType === "locker_only") return ["locker"];
  if (serviceType === "disinfect_only") return ["mist", "fan", "uvc"];
  if (serviceType === "combined") return ["locker", "mist", "fan", "uvc"];
  return [];
}

async function writeLog(input: {
  type: string;
  message: string;
  lockerId?: string | null;
  bookingId?: string | null;
  userId?: string | null;
  payload?: any;
}) {
  await db.collection("logs").add({
    ...input,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

app.get("/", (_req, res) => {
  res.status(200).send("HALO backend is running with new booking-first flow.");
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

    const lockerSnap = await db.doc(`lockers/${lockerId}`).get();

    if (!lockerSnap.exists) {
      return res.status(404).json({ ok: false, error: "LOCKER_NOT_FOUND" });
    }

    const locker = lockerSnap.data() as any;
    const currentBookingId = locker.currentBookingId ?? null;

    let booking: any = null;

    if (currentBookingId) {
      const bookingSnap = await db.doc(`bookings/${currentBookingId}`).get();

      if (bookingSnap.exists) {
        booking = {
          id: bookingSnap.id,
          ...bookingSnap.data(),
        };
      }
    }

    return res.json({
      ok: true,

      lockerId,
      lockerStatus: locker.status ?? "unknown",
      pendingPayment: !!locker.pendingPayment,
      occupied: !!locker.occupied,
      currentBookingId,

      bookingId: booking?.id ?? null,
      bookingStatus: booking?.status ?? null,
      serviceType: booking?.serviceType ?? null,
      selectedModes: booking?.selectedModes ?? [],
      amountDue: Number(booking?.amountDue ?? 0),
      amountPaid: Number(booking?.amountPaid ?? 0),
      paymentStatus: booking?.paymentStatus ?? null,
      paymentConfirmed: !!booking?.paymentConfirmed,

      bookingQrVerified: !!booking?.bookingQrVerified,
      helmetDetected: !!booking?.helmetDetected,
      doorClosed: !!booking?.doorClosed,
      programStarted: !!booking?.programStarted,
      programFinished: !!booking?.programFinished,
      programStep: booking?.programStep ?? null,
      programStepEndsAt: booking?.programStepEndsAt?.toMillis?.() ?? null,
      programRunId: booking?.programRunId ?? null,
      retrievalQrGenerated: !!booking?.retrievalQrGenerated,
      retrievalQrVerified: !!booking?.retrievalQrVerified,

      control: {
        lock: booking?.deviceStatus?.lock !== false,
        mist: !!booking?.deviceStatus?.mist,
        fan: !!booking?.deviceStatus?.fan,
        uvc: !!booking?.deviceStatus?.uvc,
      },
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

app.post("/api/device/verifyQr", async (req, res) => {
  const auth = requireDeviceKey(req);

  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }

  try {
    const { type, bookingId, lockerId, token } = parseQrPayload(req.body);

    if (!bookingId || !lockerId || !token) {
      return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });
    }

    const bookingRef = db.doc(`bookings/${bookingId}`);
    const lockerRef = db.doc(`lockers/${lockerId}`);

    const result = await db.runTransaction(async (tx) => {
      const [bookingSnap, lockerSnap] = await Promise.all([
        tx.get(bookingRef),
        tx.get(lockerRef),
      ]);

      if (!bookingSnap.exists) {
        return { ok: false as const, error: "BOOKING_NOT_FOUND" };
      }

      if (!lockerSnap.exists) {
        return { ok: false as const, error: "LOCKER_NOT_FOUND" };
      }

      const booking = bookingSnap.data() as any;
      const locker = lockerSnap.data() as any;

      if (booking.lockerId !== lockerId) {
        return { ok: false as const, error: "LOCKER_MISMATCH" };
      }

      if (locker.currentBookingId !== bookingId) {
        return { ok: false as const, error: "LOCKER_NOT_ASSIGNED_TO_BOOKING" };
      }

      if (type === "booking") {
        if (booking.status !== "awaiting_booking_qr") {
          return { ok: false as const, error: "BOOKING_QR_NOT_ALLOWED" };
        }

        if (token !== booking.userId && token !== bookingId) {
          return { ok: false as const, error: "INVALID_BOOKING_QR" };
        }

        tx.update(bookingRef, {
          status: "confirmed",
          bookingQrVerified: true,
          bookingQrVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
          programStep: "choose_mode",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          deviceStatus: {
            lock: false,
            mist: false,
            fan: false,
            uvc: false,
          },
        });

        tx.update(lockerRef, {
          status: "confirmed",
          occupied: true,
          pendingPayment: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return {
          ok: true as const,
          action: "BOOKING_QR_VERIFIED",
          unlockMs: UNLOCK_MS,
          bookingId,
          lockerId,
        };
      }

      if (booking.status !== "awaiting_retrieval_qr") {
        return { ok: false as const, error: "RETRIEVAL_QR_NOT_ALLOWED" };
      }

      if (booking.paymentConfirmed !== true && booking.paymentStatus !== "paid") {
        return { ok: false as const, error: "PAYMENT_NOT_CONFIRMED" };
      }

      const expectedToken = booking.retrievalQrToken ?? bookingId;

      if (token !== expectedToken) {
        return { ok: false as const, error: "INVALID_RETRIEVAL_QR" };
      }

      tx.update(bookingRef, {
        status: "retrieval_verified",
        retrievalQrVerified: true,
        retrievalQrVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        programStep: "open",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        deviceStatus: {
          lock: false,
          mist: false,
          fan: false,
          uvc: false,
        },
      });

      tx.update(lockerRef, {
        status: "awaiting_retrieval",
        occupied: true,
        pendingPayment: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        ok: true as const,
        action: "RETRIEVAL_QR_VERIFIED",
        unlockMs: UNLOCK_MS,
        bookingId,
        lockerId,
      };
    });

    if (!result.ok) {
      return res.status(400).json(result);
    }

    await writeLog({
      type: "QR",
      message: result.action,
      lockerId: result.lockerId,
      bookingId: result.bookingId,
    }).catch(() => {});

    return res.json(result);
  } catch (err: any) {
    console.error("verifyQr error", err);

    return res.status(500).json({
      ok: false,
      error: "INTERNAL",
      message: err?.message ?? String(err),
    });
  }
});

app.post("/api/device/sensorStatus", async (req, res) => {
  const auth = requireDeviceKey(req);

  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }

  const { lockerId, bookingId, helmetDetected, doorClosed } = req.body as {
    lockerId?: string;
    bookingId?: string;
    helmetDetected?: boolean;
    doorClosed?: boolean;
  };

  if (!lockerId || typeof helmetDetected !== "boolean") {
    return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });
  }

  try {
    const lockerSnap = await db.doc(`lockers/${lockerId}`).get();

    if (!lockerSnap.exists) {
      return res.status(404).json({ ok: false, error: "LOCKER_NOT_FOUND" });
    }

    const locker = lockerSnap.data() as any;
    const activeBookingId = bookingId || locker.currentBookingId;

    if (!activeBookingId) {
      return res.status(400).json({ ok: false, error: "NO_ACTIVE_BOOKING" });
    }

    const bookingRef = db.doc(`bookings/${activeBookingId}`);
    const bookingSnap = await bookingRef.get();

    if (!bookingSnap.exists) {
      return res.status(404).json({ ok: false, error: "BOOKING_NOT_FOUND" });
    }

    const booking = bookingSnap.data() as any;
    const safeDoorClosed = typeof doorClosed === "boolean" ? doorClosed : true;

    const patch: Record<string, any> = {
      helmetDetected,
      doorClosed: safeDoorClosed,
      helmetDetectedAt: helmetDetected
        ? admin.firestore.FieldValue.serverTimestamp()
        : null,
      doorClosedAt: safeDoorClosed
        ? admin.firestore.FieldValue.serverTimestamp()
        : null,
      lastDeviceUpdateAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (
      booking.status === "mode_selected" ||
      booking.status === "waiting_for_helmet"
    ) {
      patch.status = helmetDetected && safeDoorClosed ? "mode_selected" : "waiting_for_helmet";
      patch.programStep = helmetDetected && safeDoorClosed ? "ready_to_start" : "waiting_for_helmet";
    }

    if (booking.status === "retrieval_verified" && helmetDetected === false) {
      patch.programStep = "open";
    }

    await bookingRef.update(patch);

    return res.json({
      ok: true,
      bookingId: activeBookingId,
      helmetDetected,
      doorClosed: safeDoorClosed,
    });
  } catch (err: any) {
    console.error("sensorStatus error", err);

    return res.status(500).json({
      ok: false,
      error: "INTERNAL",
      message: err?.message ?? String(err),
    });
  }
});

app.post("/api/user/startProgram", async (req, res) => {
  const auth = await requireUserAuth(req);

  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }

  const { bookingId } = req.body as { bookingId?: string };

  if (!bookingId) {
    return res.status(400).json({ ok: false, error: "MISSING_BOOKING_ID" });
  }

  try {
    const bookingRef = db.doc(`bookings/${bookingId}`);

    const result = await db.runTransaction(async (tx) => {
      const bookingSnap = await tx.get(bookingRef);

      if (!bookingSnap.exists) {
        return { ok: false as const, error: "BOOKING_NOT_FOUND" };
      }

      const booking = bookingSnap.data() as any;

      if (booking.userId !== auth.uid) {
        return { ok: false as const, error: "FORBIDDEN" };
      }

      if (
        booking.status !== "mode_selected" &&
        booking.status !== "waiting_for_helmet"
      ) {
        return { ok: false as const, error: "BOOKING_NOT_READY" };
      }

      if (booking.bookingQrVerified !== true) {
        return { ok: false as const, error: "BOOKING_QR_NOT_VERIFIED" };
      }

      if (!booking.serviceType) {
        return { ok: false as const, error: "SERVICE_NOT_SELECTED" };
      }

      if (booking.helmetDetected !== true) {
        return { ok: false as const, error: "HELMET_NOT_DETECTED" };
      }

      if (booking.doorClosed !== true) {
        return { ok: false as const, error: "DOOR_NOT_CLOSED" };
      }

      if (booking.programStarted === true) {
        return { ok: false as const, error: "PROGRAM_ALREADY_STARTED" };
      }

      const lockerId = booking.lockerId as string | undefined;

      if (!lockerId) {
        return { ok: false as const, error: "INVALID_BOOKING" };
      }

      const serviceType = booking.serviceType as string;
      const amountDue = Number(booking.amountDue ?? amountForService(serviceType));
      const durationMin = Number(booking.durationMin ?? 600);
      const now = admin.firestore.Timestamp.now();

      const commonPatch: Record<string, any> = {
        programStarted: true,
        programStartedAt: admin.firestore.FieldValue.serverTimestamp(),
        amountDue,
        selectedModes: selectedModesForService(serviceType),
        sequenceName: serviceType,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (serviceType === "locker_only") {
        const endAt = tsPlusMs(now, Math.max(1, durationMin) * 60 * 1000);

        tx.update(bookingRef, {
          ...commonPatch,
          status: "in_use",
          programFinished: true,
          programFinishedAt: admin.firestore.FieldValue.serverTimestamp(),
          programStep: "locker_locked",
          programStepEndsAt: null,
          endAt,
          deviceStatus: {
            lock: true,
            mist: false,
            fan: false,
            uvc: false,
          },
        });

        tx.update(db.doc(`lockers/${lockerId}`), {
          status: "in_use",
          occupied: true,
          pendingPayment: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return {
          ok: true as const,
          lockerId,
          serviceType,
          programStep: "locker_locked",
        };
      }

      const programRunId = crypto.randomUUID();
      const stepEndsAt = tsPlusMs(now, stepSeconds("mist") * 1000);

      tx.update(bookingRef, {
        ...commonPatch,
        status: "disinfecting",
        programFinished: false,
        programRunId,
        programStep: "mist",
        programStepEndsAt: stepEndsAt,
        deviceStatus: {
          lock: true,
          mist: true,
          fan: false,
          uvc: false,
        },
      });

      tx.update(db.doc(`lockers/${lockerId}`), {
        status: "disinfecting",
        occupied: true,
        pendingPayment: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      tx.set(db.collection("deviceCommands").doc(`program_${bookingId}`), {
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lockerId,
        type: "sanitation_program",
        status: "queued",
        payload: {
          bookingId,
          programRunId,
          sequenceName: serviceType,
          steps: [
            { id: "mist", label: "Mist Pump", order: 0, seconds: DEFAULT_MIST_SEC },
            { id: "fan", label: "Fan", order: 1, seconds: DEFAULT_FAN_SEC },
            { id: "uvc", label: "UV-C", order: 2, seconds: DEFAULT_UV_SEC },
          ],
        },
      });

      return {
        ok: true as const,
        lockerId,
        serviceType,
        programRunId,
        programStep: "mist",
      };
    });

    if (!result.ok) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (err: any) {
    console.error("startProgram error", err);

    return res.status(500).json({
      ok: false,
      error: "INTERNAL",
      message: err?.message ?? String(err),
    });
  }
});

app.post("/api/device/programProgress", async (req, res) => {
  const auth = requireDeviceKey(req);

  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }

  const { lockerId, bookingId, programRunId, programStep } = req.body as {
    lockerId?: string;
    bookingId?: string;
    programRunId?: string;
    programStep?: string;
  };

  if (!lockerId || !bookingId || !programStep) {
    return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });
  }

  if (!["mist", "fan", "uvc", "awaiting_payment"].includes(programStep)) {
    return res.status(400).json({ ok: false, error: "INVALID_PROGRAM_STEP" });
  }

  try {
    const bookingRef = db.doc(`bookings/${bookingId}`);
    const bookingSnap = await bookingRef.get();

    if (!bookingSnap.exists) {
      return res.status(404).json({ ok: false, error: "BOOKING_NOT_FOUND" });
    }

    const booking = bookingSnap.data() as any;

    if (booking.lockerId !== lockerId) {
      return res.status(400).json({ ok: false, error: "LOCKER_MISMATCH" });
    }

    if (
      programRunId &&
      booking.programRunId &&
      booking.programRunId !== programRunId
    ) {
      return res.status(400).json({ ok: false, error: "PROGRAM_RUN_MISMATCH" });
    }

    const patch: Record<string, any> = {
      programStep,
      deviceStatus: deviceStatusForStep(programStep),
      lastDeviceUpdateAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (programStep === "awaiting_payment") {
      patch.status = "awaiting_payment";
      patch.programFinished = true;
      patch.programFinishedAt = admin.firestore.FieldValue.serverTimestamp();
      patch.programStepEndsAt = null;
      patch.deviceStatus = {
        lock: true,
        mist: false,
        fan: false,
        uvc: false,
      };

      await db.doc(`lockers/${lockerId}`).update({
        status: "awaiting_payment",
        pendingPayment: true,
        occupied: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      const now = admin.firestore.Timestamp.now();
      patch.programStepEndsAt = tsPlusMs(now, stepSeconds(programStep) * 1000);
    }

    await bookingRef.update(patch);

    return res.json({
      ok: true,
      bookingId,
      lockerId,
      programStep,
    });
  } catch (err: any) {
    console.error("programProgress error", err);

    return res.status(500).json({
      ok: false,
      error: "INTERNAL",
      message: err?.message ?? String(err),
    });
  }
});

app.post("/api/user/requestPayment", async (req, res) => {
  const auth = await requireUserAuth(req);

  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }

  const { bookingId } = req.body as { bookingId?: string };

  if (!bookingId) {
    return res.status(400).json({ ok: false, error: "MISSING_BOOKING_ID" });
  }

  try {
    const bookingRef = db.doc(`bookings/${bookingId}`);

    const result = await db.runTransaction(async (tx) => {
      const bookingSnap = await tx.get(bookingRef);

      if (!bookingSnap.exists) {
        return { ok: false as const, error: "BOOKING_NOT_FOUND" };
      }

      const booking = bookingSnap.data() as any;

      if (booking.userId !== auth.uid) {
        return { ok: false as const, error: "FORBIDDEN" };
      }

      if (booking.status !== "in_use") {
        return { ok: false as const, error: "BOOKING_NOT_IN_USE" };
      }

      if (booking.serviceType !== "locker_only") {
        return { ok: false as const, error: "PAYMENT_AUTO_AFTER_DISINFECTION" };
      }

      const lockerId = booking.lockerId as string;

      tx.update(bookingRef, {
        status: "awaiting_payment",
        programStep: "awaiting_payment",
        paymentStatus: "unpaid",
        paymentConfirmed: false,
        amountDue: Number(booking.amountDue ?? amountForService("locker_only")),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        deviceStatus: {
          lock: true,
          mist: false,
          fan: false,
          uvc: false,
        },
      });

      tx.update(db.doc(`lockers/${lockerId}`), {
        status: "awaiting_payment",
        pendingPayment: true,
        occupied: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { ok: true as const, lockerId };
    });

    if (!result.ok) {
      return res.status(400).json(result);
    }

    return res.json({
      ok: true,
      action: "AWAITING_PAYMENT",
      lockerId: result.lockerId,
    });
  } catch (err: any) {
    console.error("requestPayment error", err);

    return res.status(500).json({
      ok: false,
      error: "INTERNAL",
      message: err?.message ?? String(err),
    });
  }
});

app.post("/api/confirmPayment", async (req, res) => {
  const auth = requireDeviceKey(req);

  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }

  const { lockerId, deviceId, paymentPayload, provider, amountPaid } =
    req.body as {
      lockerId?: string;
      deviceId?: string;
      paymentPayload?: string;
      provider?: string;
      amountPaid?: number;
    };

  if (!lockerId || !paymentPayload) {
    return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });
  }

  try {
    const lockerRef = db.doc(`lockers/${lockerId}`);

    const result = await db.runTransaction(async (tx) => {
      const lockerSnap = await tx.get(lockerRef);

      if (!lockerSnap.exists) {
        return { ok: false as const, error: "LOCKER_NOT_FOUND" };
      }

      const locker = lockerSnap.data() as any;
      const bookingId = locker.currentBookingId as string | undefined;

      if (!bookingId) {
        return { ok: false as const, error: "NO_ACTIVE_BOOKING" };
      }

      const bookingRef = db.doc(`bookings/${bookingId}`);
      const bookingSnap = await tx.get(bookingRef);

      if (!bookingSnap.exists) {
        return { ok: false as const, error: "BOOKING_NOT_FOUND" };
      }

      const booking = bookingSnap.data() as any;

      if (booking.status !== "awaiting_payment") {
        return { ok: false as const, error: "NOT_AWAITING_PAYMENT" };
      }

      const requiredAmount = Number(
        booking.amountDue ?? amountForService(booking.serviceType ?? "locker_only")
      );

      const paid = Number(amountPaid ?? 0);

      if (!Number.isFinite(paid) || paid < requiredAmount) {
        return {
          ok: false as const,
          error: "INSUFFICIENT_PAYMENT",
          requiredAmount,
          amountPaid: paid,
        };
      }

      const paymentRef = db.collection("payments").doc();
      const retrievalQrToken = crypto.randomUUID();

      tx.set(paymentRef, {
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        userId: booking.userId ?? null,
        bookingId,
        lockerId,
        provider: provider ?? "cash",
        paymentMethod: "coin_slot",
        rawPayload: paymentPayload,
        status: "paid",
        deviceId: deviceId ?? null,
        amountPaid: paid,
        requiredAmount,
      });

      tx.update(bookingRef, {
        status: "awaiting_retrieval_qr",
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
        paymentId: paymentRef.id,
        paymentConfirmed: true,
        paymentStatus: "paid",
        paymentProvider: provider ?? "cash",
        paymentPayload,
        amountPaid: paid,
        retrievalQrGenerated: true,
        retrievalQrToken,
        retrievalQrVerified: false,
        retrievalQrVerifiedAt: null,
        programStep: "awaiting_retrieval",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        deviceStatus: {
          lock: true,
          mist: false,
          fan: false,
          uvc: false,
        },
      });

      tx.update(lockerRef, {
        status: "awaiting_retrieval",
        pendingPayment: false,
        pendingPaymentExpiresAt: null,
        lastPaymentAt: admin.firestore.FieldValue.serverTimestamp(),
        currentBookingId: bookingId,
        occupied: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        ok: true as const,
        bookingId,
        requiredAmount,
        amountPaid: paid,
      };
    });

    if (!result.ok) {
      return res.status(400).json(result);
    }

    return res.json({
      ok: true,
      action: "PAYMENT_CONFIRMED",
      bookingId: result.bookingId,
      requiredAmount: result.requiredAmount,
      amountPaid: result.amountPaid,
    });
  } catch (err: any) {
    console.error("confirmPayment error", err);

    return res.status(500).json({
      ok: false,
      error: "INTERNAL",
      message: err?.message ?? String(err),
    });
  }
});

app.post("/api/user/open", async (req, res) => {
  const auth = await requireUserAuth(req);

  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }

  const { bookingId } = req.body as { bookingId?: string };

  if (!bookingId) {
    return res.status(400).json({ ok: false, error: "MISSING_BOOKING_ID" });
  }

  try {
    const bookingRef = db.doc(`bookings/${bookingId}`);

    const result = await db.runTransaction(async (tx) => {
      const bookingSnap = await tx.get(bookingRef);

      if (!bookingSnap.exists) {
        return { ok: false as const, error: "BOOKING_NOT_FOUND" };
      }

      const booking = bookingSnap.data() as any;

      if (booking.userId !== auth.uid) {
        return { ok: false as const, error: "FORBIDDEN" };
      }

      if (booking.status !== "retrieval_verified") {
        return { ok: false as const, error: "RETRIEVAL_QR_NOT_VERIFIED" };
      }

      if (booking.retrievalQrVerified !== true) {
        return { ok: false as const, error: "QR_NOT_VERIFIED" };
      }

      tx.update(bookingRef, {
        programStep: "open",
        openedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        deviceStatus: {
          lock: false,
          mist: false,
          fan: false,
          uvc: false,
        },
      });

      return { ok: true as const, lockerId: booking.lockerId };
    });

    if (!result.ok) {
      return res.status(400).json(result);
    }

    return res.json({
      ok: true,
      action: "OPEN",
      lockerId: result.lockerId,
    });
  } catch (err: any) {
    console.error("user open error", err);

    return res.status(500).json({
      ok: false,
      error: "INTERNAL",
      message: err?.message ?? String(err),
    });
  }
});

app.post("/api/user/complete", async (req, res) => {
  const auth = await requireUserAuth(req);

  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }

  const { bookingId } = req.body as { bookingId?: string };

  if (!bookingId) {
    return res.status(400).json({ ok: false, error: "MISSING_BOOKING_ID" });
  }

  try {
    const bookingRef = db.doc(`bookings/${bookingId}`);

    const result = await db.runTransaction(async (tx) => {
      const bookingSnap = await tx.get(bookingRef);

      if (!bookingSnap.exists) {
        return {
          ok: false as const,
          error: "BOOKING_NOT_FOUND",
          message: "Booking record was not found.",
        };
      }

      const booking = bookingSnap.data() as any;

      if (booking.userId !== auth.uid) {
        return {
          ok: false as const,
          error: "FORBIDDEN",
          message: "You are not allowed to complete this booking.",
        };
      }

      if (booking.status !== "retrieval_verified") {
        return {
          ok: false as const,
          error: "BOOKING_NOT_READY",
          message: "Booking is not ready to complete.",
        };
      }

      if (booking.retrievalQrVerified !== true) {
        return {
          ok: false as const,
          error: "QR_NOT_VERIFIED",
          message: "Please scan the retrieval QR first.",
        };
      }

      if (booking.programStep !== "open") {
        return {
          ok: false as const,
          error: "LOCKER_NOT_OPENED",
          message: "Please open the locker before completing the booking.",
        };
      }

      if (booking.helmetDetected === true) {
        return {
          ok: false as const,
          error: "HELMET_STILL_INSIDE",
          message:
            "Helmet is still detected inside the locker. Please retrieve it before completing the booking.",
        };
      }

      const lockerId = booking.lockerId as string | undefined;

      if (!lockerId) {
        return {
          ok: false as const,
          error: "INVALID_BOOKING",
          message: "Booking has no assigned locker.",
        };
      }

      const lockerRef = db.doc(`lockers/${lockerId}`);
      const lockerSnap = await tx.get(lockerRef);

      if (!lockerSnap.exists) {
        return {
          ok: false as const,
          error: "LOCKER_NOT_FOUND",
          message: "Locker record was not found.",
        };
      }

      const locker = lockerSnap.data() as any;

      tx.update(bookingRef, {
        status: "completed",
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        completedByUserId: auth.uid,
        programStep: "completed",
        programFinished: true,
        retrievalQrVerified: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        deviceStatus: {
          lock: true,
          mist: false,
          fan: false,
          uvc: false,
        },
      });

      tx.update(lockerRef, {
        status: "available",
        occupied: false,
        currentBookingId: null,
        reservedByUserId: null,
        pendingPayment: false,
        reservationExpiresAt: null,
        pendingPaymentExpiresAt: null,
        lastCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastDisinfectionAt:
          booking.serviceType === "disinfect_only" ||
          booking.serviceType === "combined"
            ? admin.firestore.FieldValue.serverTimestamp()
            : locker.lastDisinfectionAt ?? null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { ok: true as const, lockerId };
    });

    if (!result.ok) {
      return res.status(400).json(result);
    }

    return res.json({
      ok: true,
      action: "COMPLETED",
      lockerId: result.lockerId,
    });
  } catch (err: any) {
    console.error("user complete error", err);

    return res.status(500).json({
      ok: false,
      error: "INTERNAL",
      message: err?.message ?? String(err),
    });
  }
});

app.post("/api/expireNow", async (_req, res) => {
  return res.json({
    ok: true,
    message: "Manual expiration is not used in the new flow.",
  });
});

const port = Number(process.env.PORT) || 3000;

app.listen(port, "0.0.0.0", () => {
  console.log(`HALO backend listening on port ${port}`);
});
