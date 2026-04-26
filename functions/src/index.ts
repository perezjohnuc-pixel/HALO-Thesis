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

const QR_SECRET = process.env.QR_SECRET?.trim() || "dev-secret";
const DEVICE_API_KEY = process.env.DEVICE_API_KEY?.trim() || "dev-device-key";

const UNLOCK_MS = 5000;

const DEFAULT_MIST_SEC = Number(process.env.MIST_SECONDS || 180);
const DEFAULT_DRYER_SEC = Number(process.env.DRYER_SECONDS || 180);
const DEFAULT_UV_SEC = Number(process.env.DEFAULT_UV_SECONDS || 180);

function tsPlusMs(ts: admin.firestore.Timestamp, ms: number) {
  return admin.firestore.Timestamp.fromMillis(ts.toMillis() + ms);
}

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function safeEq(a?: string, b?: string) {
  if (!a || !b) return false;

  const ab = Buffer.from(a);
  const bb = Buffer.from(b);

  if (ab.length !== bb.length) return false;

  return crypto.timingSafeEqual(ab, bb);
}

function requireDeviceKey(req: express.Request) {
  const header = (req.get("x-halo-device-key") || "").toString();
  const bearer = (req.get("authorization") || "").toString();

  const token =
    header ||
    (bearer.startsWith("Bearer ") ? bearer.slice("Bearer ".length) : "");

  if (!token) {
    return {
      ok: false as const,
      status: 401,
      error: "MISSING_DEVICE_KEY",
    };
  }

  if (token !== DEVICE_API_KEY) {
    return {
      ok: false as const,
      status: 403,
      error: "INVALID_DEVICE_KEY",
    };
  }

  return { ok: true as const };
}

async function requireUserAuth(req: express.Request) {
  const authHeader = (req.get("authorization") || "").toString();
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";

  if (!token) {
    return {
      ok: false as const,
      status: 401,
      error: "MISSING_AUTH_TOKEN",
    };
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return {
      ok: true as const,
      uid: decoded.uid,
    };
  } catch {
    return {
      ok: false as const,
      status: 401,
      error: "INVALID_AUTH_TOKEN",
    };
  }
}

function parseQrPayload(body: any) {
  if (body.qrPayload && typeof body.qrPayload === "string") {
    const raw = body.qrPayload.trim();

    // New short QR format:
    // HALO|bookingId|lockerId|token
    if (raw.startsWith("HALO|")) {
      const parts = raw.split("|");

      return {
        bookingId: parts[1],
        lockerId: parts[2],
        token: parts[3],
      };
    }

    // Old JSON QR format support:
    // {"v":1,"type":"claim","bookingId":"...","lockerId":"...","token":"..."}
    const parsed = JSON.parse(raw);

    return {
      bookingId: parsed.bookingId,
      lockerId: parsed.lockerId,
      token: parsed.token,
    };
  }

  return {
    bookingId: body.bookingId,
    lockerId: body.lockerId,
    token: body.token,
  };
}

function deviceStatusForStep(step: string) {
  if (step === "mist") {
    return {
      lock: true,
      mist: true,
      fan: false,
      uvc: false,
    };
  }

  if (step === "fan" || step === "dryer") {
    return {
      lock: true,
      mist: false,
      fan: true,
      uvc: false,
    };
  }

  if (step === "uvc") {
    return {
      lock: true,
      mist: false,
      fan: false,
      uvc: true,
    };
  }

  return {
    lock: true,
    mist: false,
    fan: false,
    uvc: false,
  };
}

function stepSeconds(step: string) {
  if (step === "mist") return DEFAULT_MIST_SEC;
  if (step === "fan" || step === "dryer") return DEFAULT_DRYER_SEC;
  if (step === "uvc") return DEFAULT_UV_SEC;

  return 0;
}

app.get("/", (_req, res) => {
  res.status(200).send("HALO Railway backend is running");
});

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/api/device/lockerStatus", async (req, res) => {
  const auth = requireDeviceKey(req);

  if (!auth.ok) {
    return res.status(auth.status).json({
      ok: false,
      error: auth.error,
    });
  }

  try {
    const lockerId = String(req.query.lockerId || "").trim();

    if (!lockerId) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_LOCKER_ID",
      });
    }

    const lockerSnap = await db.doc(`lockers/${lockerId}`).get();

    if (!lockerSnap.exists) {
      return res.status(404).json({
        ok: false,
        error: "LOCKER_NOT_FOUND",
      });
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
      amountDue: Number(booking?.amount ?? 0),
      serviceType: booking?.serviceType ?? null,

      helmetDetected: !!booking?.helmetDetected,
      doorClosed: !!booking?.doorClosed,
      programStarted: !!booking?.programStarted,
      programFinished: !!booking?.programFinished,
      programStep: booking?.programStep ?? null,
      programStepEndsAt: booking?.programStepEndsAt?.toMillis?.() ?? null,
      programRunId: booking?.programRunId ?? null,
      retrievalQrVerified: !!booking?.retrievalQrVerified,

      control: {
        lock: !!booking?.deviceStatus?.lock,
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

app.post("/api/confirmPayment", async (req, res) => {
  const auth = requireDeviceKey(req);

  if (!auth.ok) {
    return res.status(auth.status).json({
      ok: false,
      error: auth.error,
    });
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
    return res.status(400).json({
      ok: false,
      error: "MISSING_FIELDS",
    });
  }

  try {
    const lockerRef = db.doc(`lockers/${lockerId}`);

    const result = await db.runTransaction(async (tx) => {
      const lSnap = await tx.get(lockerRef);

      if (!lSnap.exists) {
        return {
          ok: false as const,
          error: "LOCKER_NOT_FOUND",
        };
      }

      const locker = lSnap.data() as any;
      const bookingId = locker.currentBookingId as string | undefined;

      if (!bookingId) {
        return {
          ok: false as const,
          error: "NO_ACTIVE_BOOKING",
        };
      }

      const bookingRef = db.doc(`bookings/${bookingId}`);
      const bSnap = await tx.get(bookingRef);

      if (!bSnap.exists) {
        return {
          ok: false as const,
          error: "BOOKING_NOT_FOUND",
        };
      }

      const booking = bSnap.data() as any;

      if (booking.status !== "pending_payment") {
        return {
          ok: false as const,
          error: "NOT_AWAITING_PAYMENT",
        };
      }

      const holdMs = booking.holdExpiresAt?.toMillis?.() as number | undefined;

      if (typeof holdMs === "number" && Date.now() > holdMs) {
        tx.update(bookingRef, {
          status: "expired",
          expiredAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        tx.update(lockerRef, {
          status: "available",
          occupied: false,
          currentBookingId: null,
          pendingPayment: false,
          pendingPaymentExpiresAt: null,
        });

        return {
          ok: false as const,
          error: "PAYMENT_WINDOW_EXPIRED",
        };
      }

      const requiredAmount = Number(booking.amount ?? 25);
      const paid = Number(amountPaid ?? 0);

      if (!Number.isFinite(paid) || paid < requiredAmount) {
        return {
          ok: false as const,
          error: "INSUFFICIENT_PAYMENT",
          requiredAmount,
          amountPaid: paid,
        };
      }

      const now = admin.firestore.Timestamp.now();
      const durationMin = Number(booking.durationMin ?? 600);
      const endAt = tsPlusMs(now, Math.max(1, durationMin) * 60 * 1000);

      const payRef = db.collection("payments").doc();

      tx.set(payRef, {
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        userId: booking.userId ?? null,
        bookingId,
        lockerId,
        provider: provider ?? "cash",
        rawPayload: paymentPayload,
        status: "paid",
        deviceId: deviceId ?? null,
        amountPaid: paid,
        requiredAmount,
      });

      tx.update(bookingRef, {
        status: "active",
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
        paymentId: payRef.id,
        holdExpiresAt: null,
        activeAt: admin.firestore.FieldValue.serverTimestamp(),
        endAt,

        paymentConfirmed: true,
        paymentStatus: "paid",
        userControlEnabled: true,
        adminOverride: false,
        paymentProvider: provider ?? "cash",
        paymentPayload,

        helmetDetected: false,
        doorClosed: true,
        programStarted: false,
        programFinished: false,
        programStep: "waiting_helmet",
        programStepEndsAt: null,
        retrievalQrVerified: false,

        deviceStatus: {
          lock: false,
          mist: false,
          fan: false,
          uvc: false,
        },
      });

      tx.update(lockerRef, {
        status: "active",
        pendingPayment: false,
        pendingPaymentExpiresAt: null,
        lastPaymentAt: admin.firestore.FieldValue.serverTimestamp(),
        currentBookingId: bookingId,
        occupied: false,
      });

      return {
        ok: true as const,
        bookingId,
        unlockMs: UNLOCK_MS,
        requiredAmount,
        amountPaid: paid,
        endsAt: endAt.toMillis(),
      };
    });

    if (!result.ok) {
      return res.status(400).json(result);
    }

    return res.json({
      ok: true,
      action: "UNLOCK",
      bookingId: result.bookingId,
      unlockMs: result.unlockMs,
      requiredAmount: result.requiredAmount,
      amountPaid: result.amountPaid,
      endsAt: result.endsAt,
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

app.post("/api/device/sensorStatus", async (req, res) => {
  const auth = requireDeviceKey(req);

  if (!auth.ok) {
    return res.status(auth.status).json({
      ok: false,
      error: auth.error,
    });
  }

  const { lockerId, bookingId, helmetDetected, doorClosed } = req.body as {
    lockerId?: string;
    bookingId?: string;
    helmetDetected?: boolean;
    doorClosed?: boolean;
  };

  if (!lockerId || typeof helmetDetected !== "boolean") {
    return res.status(400).json({
      ok: false,
      error: "MISSING_FIELDS",
    });
  }

  try {
    const lockerSnap = await db.doc(`lockers/${lockerId}`).get();

    if (!lockerSnap.exists) {
      return res.status(404).json({
        ok: false,
        error: "LOCKER_NOT_FOUND",
      });
    }

    const locker = lockerSnap.data() as any;
    const activeBookingId = bookingId || locker.currentBookingId;

    if (!activeBookingId) {
      return res.status(400).json({
        ok: false,
        error: "NO_ACTIVE_BOOKING",
      });
    }

    const bookingRef = db.doc(`bookings/${activeBookingId}`);
    const bookingSnap = await bookingRef.get();

    if (!bookingSnap.exists) {
      return res.status(404).json({
        ok: false,
        error: "BOOKING_NOT_FOUND",
      });
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
    };

    if (booking.status === "active" && booking.programStarted !== true) {
      patch.programStep = helmetDetected ? "ready_to_start" : "waiting_helmet";
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
    return res.status(auth.status).json({
      ok: false,
      error: auth.error,
    });
  }

  const { bookingId, sequenceName } = req.body as {
    bookingId?: string;
    selectedModes?: string[];
    sequenceName?: string;
  };

  if (!bookingId) {
    return res.status(400).json({
      ok: false,
      error: "MISSING_FIELDS",
    });
  }

  try {
    const bookingRef = db.doc(`bookings/${bookingId}`);

    const result = await db.runTransaction(async (tx) => {
      const bSnap = await tx.get(bookingRef);

      if (!bSnap.exists) {
        return {
          ok: false as const,
          error: "BOOKING_NOT_FOUND",
        };
      }

      const booking = bSnap.data() as any;

      if (booking.userId !== auth.uid) {
        return {
          ok: false as const,
          error: "FORBIDDEN",
        };
      }

      if (booking.status !== "active") {
        return {
          ok: false as const,
          error: "BOOKING_NOT_ACTIVE",
        };
      }

      if (booking.paymentConfirmed !== true && booking.paymentStatus !== "paid") {
        return {
          ok: false as const,
          error: "PAYMENT_NOT_CONFIRMED",
        };
      }

      if (booking.programStarted === true) {
        return {
          ok: false as const,
          error: "PROGRAM_ALREADY_STARTED",
        };
      }

      if (booking.helmetDetected !== true) {
        return {
          ok: false as const,
          error: "HELMET_NOT_DETECTED",
        };
      }

      const lockerId = booking.lockerId as string | undefined;

      if (!lockerId) {
        return {
          ok: false as const,
          error: "INVALID_BOOKING",
        };
      }

      const serviceType = booking.serviceType ?? "locker_only";

      if (serviceType === "locker_only") {
        tx.update(bookingRef, {
          programStarted: true,
          programFinished: true,
          programStep: "locker_locked",
          programStepEndsAt: null,
          selectedModes: [],
          sequenceName: "locker_only",
          deviceStatus: {
            lock: true,
            mist: false,
            fan: false,
            uvc: false,
          },
          startedByUserAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return {
          ok: true as const,
          lockerId,
          serviceType,
          programStep: "locker_locked",
        };
      }

      const programRunId = crypto.randomUUID();
      const now = admin.firestore.Timestamp.now();
      const stepEndsAt = tsPlusMs(now, stepSeconds("mist") * 1000);

      tx.update(bookingRef, {
        programStarted: true,
        programFinished: false,
        programRunId,
        programStep: "mist",
        programStepEndsAt: stepEndsAt,
        selectedModes: ["mist", "dryer", "uvc"],
        sequenceName: serviceType === "combined" ? "combined" : "disinfectant",
        deviceStatus: {
          lock: true,
          mist: true,
          fan: false,
          uvc: false,
        },
        startedByUserAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      tx.set(db.collection("deviceCommands").doc(`program_${bookingId}`), {
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lockerId,
        type: "sanitation_program",
        status: "queued",
        payload: {
          bookingId,
          programRunId,
          sequenceName: sequenceName ?? serviceType,
          steps: [
            {
              id: "mist",
              order: 0,
              seconds: DEFAULT_MIST_SEC,
            },
            {
              id: "fan",
              order: 1,
              seconds: DEFAULT_DRYER_SEC,
            },
            {
              id: "uvc",
              order: 2,
              seconds: DEFAULT_UV_SEC,
            },
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
    return res.status(auth.status).json({
      ok: false,
      error: auth.error,
    });
  }

  const { lockerId, bookingId, programRunId, programStep } = req.body as {
    lockerId?: string;
    bookingId?: string;
    programRunId?: string;
    programStep?: string;
  };

  if (!lockerId || !bookingId || !programStep) {
    return res.status(400).json({
      ok: false,
      error: "MISSING_FIELDS",
    });
  }

  if (!["mist", "fan", "uvc", "awaiting_retrieval"].includes(programStep)) {
    return res.status(400).json({
      ok: false,
      error: "INVALID_PROGRAM_STEP",
    });
  }

  try {
    const bookingRef = db.doc(`bookings/${bookingId}`);
    const bookingSnap = await bookingRef.get();

    if (!bookingSnap.exists) {
      return res.status(404).json({
        ok: false,
        error: "BOOKING_NOT_FOUND",
      });
    }

    const booking = bookingSnap.data() as any;

    if (booking.lockerId !== lockerId) {
      return res.status(400).json({
        ok: false,
        error: "LOCKER_MISMATCH",
      });
    }

    if (programRunId && booking.programRunId && booking.programRunId !== programRunId) {
      return res.status(400).json({
        ok: false,
        error: "PROGRAM_RUN_MISMATCH",
      });
    }

    const patch: Record<string, any> = {
      programStep,
      deviceStatus: deviceStatusForStep(programStep),
      lastDeviceUpdateAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (programStep === "awaiting_retrieval") {
      patch.programFinished = true;
      patch.programStepEndsAt = null;
      patch.programFinishedAt = admin.firestore.FieldValue.serverTimestamp();
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

app.post("/api/device/verifyQr", async (req, res) => {
  const auth = requireDeviceKey(req);

  if (!auth.ok) {
    return res.status(auth.status).json({
      ok: false,
      error: auth.error,
    });
  }

  try {
    const { bookingId, lockerId, token } = parseQrPayload(req.body);

    if (!bookingId || !lockerId || !token) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_FIELDS",
        message: "QR payload must contain bookingId, lockerId, and token.",
      });
    }

    const bookingRef = db.doc(`bookings/${bookingId}`);
    const lockerRef = db.doc(`lockers/${lockerId}`);

    const result = await db.runTransaction(async (tx) => {
      const [bSnap, lSnap] = await Promise.all([
        tx.get(bookingRef),
        tx.get(lockerRef),
      ]);

      if (!bSnap.exists) {
        return {
          ok: false as const,
          error: "BOOKING_NOT_FOUND",
        };
      }

      if (!lSnap.exists) {
        return {
          ok: false as const,
          error: "LOCKER_NOT_FOUND",
        };
      }

      const booking = bSnap.data() as any;
      const locker = lSnap.data() as any;

      if (booking.lockerId !== lockerId) {
        return {
          ok: false as const,
          error: "LOCKER_MISMATCH",
        };
      }

      if (locker.currentBookingId !== bookingId) {
        return {
          ok: false as const,
          error: "LOCKER_NOT_ASSIGNED_TO_BOOKING",
        };
      }

      if (booking.status !== "active") {
        return {
          ok: false as const,
          error: "BOOKING_NOT_ACTIVE",
        };
      }

      const expectedToken = booking.claimQrToken ?? bookingId;

      const expectedHash = sha256Hex(`${expectedToken}|${QR_SECRET}`);
      const receivedHash = sha256Hex(`${token}|${QR_SECRET}`);

      if (!safeEq(expectedHash, receivedHash)) {
        return {
          ok: false as const,
          error: "INVALID_QR_TOKEN",
        };
      }

      tx.update(bookingRef, {
        retrievalQrVerified: true,
        qrVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        programStep: "awaiting_open",
        deviceStatus: {
          lock: true,
          mist: false,
          fan: false,
          uvc: false,
        },
      });

      return {
        ok: true as const,
        bookingId,
        lockerId,
      };
    });

    if (!result.ok) {
      return res.status(400).json(result);
    }

    return res.json({
      ok: true,
      action: "QR_VERIFIED",
      bookingId: result.bookingId,
      lockerId: result.lockerId,
    });
  } catch (err: any) {
    console.error("verifyQr error", err);

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
    return res.status(auth.status).json({
      ok: false,
      error: auth.error,
    });
  }

  const { bookingId } = req.body as {
    bookingId?: string;
  };

  if (!bookingId) {
    return res.status(400).json({
      ok: false,
      error: "MISSING_BOOKING_ID",
    });
  }

  try {
    const bookingRef = db.doc(`bookings/${bookingId}`);

    const result = await db.runTransaction(async (tx) => {
      const bSnap = await tx.get(bookingRef);

      if (!bSnap.exists) {
        return {
          ok: false as const,
          error: "BOOKING_NOT_FOUND",
        };
      }

      const booking = bSnap.data() as any;

      if (booking.userId !== auth.uid) {
        return {
          ok: false as const,
          error: "FORBIDDEN",
        };
      }

      if (booking.status !== "active") {
        return {
          ok: false as const,
          error: "BOOKING_NOT_ACTIVE",
        };
      }

      if (booking.retrievalQrVerified !== true) {
        return {
          ok: false as const,
          error: "QR_NOT_VERIFIED",
        };
      }

      tx.update(bookingRef, {
        programStep: "open",
        openedAt: admin.firestore.FieldValue.serverTimestamp(),
        deviceStatus: {
          lock: false,
          mist: false,
          fan: false,
          uvc: false,
        },
      });

      return {
        ok: true as const,
        lockerId: booking.lockerId,
      };
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
    return res.status(auth.status).json({
      ok: false,
      error: auth.error,
    });
  }

  const { bookingId, selectedModes, sequenceName } = req.body as {
    bookingId?: string;
    selectedModes?: string[];
    sequenceName?: string;
  };

  if (!bookingId) {
    return res.status(400).json({
      ok: false,
      error: "MISSING_FIELDS",
    });
  }

  try {
    const bookingRef = db.doc(`bookings/${bookingId}`);

    const result = await db.runTransaction(async (tx) => {
      const bSnap = await tx.get(bookingRef);

      if (!bSnap.exists) {
        return {
          ok: false as const,
          error: "BOOKING_NOT_FOUND",
        };
      }

      const booking = bSnap.data() as any;

      if (booking.userId !== auth.uid) {
        return {
          ok: false as const,
          error: "FORBIDDEN",
        };
      }

      if (booking.status !== "active") {
        return { ok: false as const, error: "BOOKING_NOT_ACTIVE" };
      }

      const lockerId = booking.lockerId as string | undefined;

      if (!lockerId) {
        return {
          ok: false as const,
          error: "INVALID_BOOKING",
        };
      }

      const lockerRef = db.doc(`lockers/${lockerId}`);

      tx.update(bookingRef, {
        status: "completed",
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        completedByUserId: auth.uid,
        selectedModes: Array.isArray(selectedModes) ? selectedModes : [],
        sequenceName: sequenceName ?? booking.sequenceName ?? "custom",
        programStep: "completed",
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
        lastDisinfectionAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        ok: true as const,
        lockerId,
      };
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

const port = Number(process.env.PORT) || 3000;

app.listen(port, "0.0.0.0", () => {
  console.log(`HALO backend listening on port ${port}`);
});
