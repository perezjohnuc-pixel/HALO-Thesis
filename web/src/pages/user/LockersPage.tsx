import { useEffect, useState } from "react";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { db } from "../../lib/firebase";
import { useAuth } from "../../lib/auth";
import { Button, Card, CardBody, CardHeader, Badge } from "../../components/ui";
import StatusPill from "../../components/StatusPill";

type LockerDoc = {
  id: string;
  name?: string;
  location?: string;
  status?: string;
  occupied?: boolean;
  pendingPayment?: boolean;
  currentBookingId?: string | null;
  battery?: number;
  batteryPct?: number;
  lastHeartbeatAt?: any;
};

type BookingDoc = {
  id: string;
  userId?: string;
  lockerId?: string;
  status?: string;
  paymentStatus?: string;
};

const ACTIVE_BOOKING_STATUSES = [
  "awaiting_booking_qr",
  "confirmed",
  "mode_selected",
  "waiting_for_helmet",
  "in_use",
  "disinfecting",
  "awaiting_payment",
  "paid",
  "awaiting_retrieval_qr",
  "retrieval_verified",
];

function getStatus(locker: LockerDoc) {
  if (locker.status) return locker.status;
  if (locker.pendingPayment) return "awaiting_payment";
  if (locker.occupied) return "in_use";
  return "available";
}

export default function LockersPage() {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const navigate = useNavigate();

  const [lockers, setLockers] = useState<LockerDoc[]>([]);
  const [activeBooking, setActiveBooking] = useState<BookingDoc | null>(null);
  const [busyLockerId, setBusyLockerId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, "lockers"), orderBy("name", "asc"));

    return onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as LockerDoc[];

        setLockers(rows);
      },
      (e) => setErr(e.message)
    );
  }, []);

  useEffect(() => {
    if (!uid) return;

    const q = query(
      collection(db, "bookings"),
      where("userId", "==", uid),
      orderBy("createdAt", "desc"),
      limit(10)
    );

    return onSnapshot(
      q,
      (snap) => {
        const recent = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }) as BookingDoc)
          .find((b) => ACTIVE_BOOKING_STATUSES.includes(b.status ?? ""));

        setActiveBooking(recent ?? null);
      },
      (e) => setErr(e.message)
    );
  }, [uid]);

  async function reserveLocker(locker: LockerDoc) {
    if (!uid) {
      navigate("/auth/login");
      return;
    }

    if (getStatus(locker) !== "available") {
      setErr("This locker is not available right now.");
      return;
    }

    if (activeBooking) {
      setErr("You already have an active booking. Please finish or cancel it first.");
      navigate("/app/booking");
      return;
    }

    try {
      setErr(null);
      setBusyLockerId(locker.id);

      const bookingRef = doc(collection(db, "bookings"));
      const lockerRef = doc(db, "lockers", locker.id);

      const reservationExpiresAt = new Date(Date.now() + 5 * 60 * 1000);

      const batch = writeBatch(db);

      batch.set(bookingRef, {
        userId: uid,
        lockerId: locker.id,

        status: "awaiting_booking_qr",

        serviceType: null,
        selectedModes: [],
        durationMin: 0,

        bookingQrVerified: false,
        bookingQrVerifiedAt: null,

        helmetDetected: false,
        helmetDetectedAt: null,
        doorClosed: false,
        doorClosedAt: null,

        programStarted: false,
        programFinished: false,
        programRunId: null,
        programStep: "awaiting_booking_qr",
        programStepEndsAt: null,

        amountDue: 0,
        baseAmountDue: 0,
        extraCharge: 0,
        extraChargeUnits: 0,
        extraChargeReason: "none",

        amountPaid: 0,
        paymentStatus: "unpaid",
        paymentMethod: "cash",
        paymentProvider: "cash",
        paymentConfirmed: false,
        paymentId: null,
        paidAt: null,

        retrievalQrGenerated: false,
        retrievalQrToken: null,
        retrievalQrVerified: false,
        retrievalQrVerifiedAt: null,

        deviceStatus: {
          lock: true,
          mist: false,
          fan: false,
          uvc: false,
        },

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        reservationExpiresAt,
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        expiredAt: null,
        pickupReadyAt: null,
        unattendedChargeStartsAt: null,
      });

      batch.update(lockerRef, {
        status: "reserved",
        occupied: true,
        pendingPayment: false,
        currentBookingId: bookingRef.id,
        reservedByUserId: uid,
        reservationExpiresAt,
        pendingPaymentExpiresAt: null,
        updatedAt: serverTimestamp(),
      });

      await batch.commit();
      navigate("/app/booking");
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusyLockerId(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="text-sm uppercase tracking-wide text-slate-400">
            Customer
          </div>
          <div className="text-2xl font-bold">Lockers</div>
          <div className="text-sm text-slate-400">
            Reserve an available locker first. The booking QR must be scanned
            within 5 minutes or the reservation will expire.
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-lg font-bold">Reserve a locker</div>
              <div className="text-sm text-slate-400">
                Flow: Reserve → Scan personal QR within 5 minutes → Select mode
                → Use locker → Pay → Scan retrieval QR.
              </div>
            </div>

            <Badge color={activeBooking ? "yellow" : "green"}>
              {activeBooking ? "Active booking found" : "No active booking"}
            </Badge>
          </div>
        </CardHeader>

        <CardBody>
          {err && (
            <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              {err}
            </div>
          )}

          {activeBooking && (
            <div className="mb-4 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-100">
              You already have a booking. Go to My Booking to continue QR
              confirmation, mode selection, payment, or retrieval.
              <div className="mt-3">
                <Button size="sm" onClick={() => navigate("/app/booking")}>
                  Go to My Booking
                </Button>
              </div>
            </div>
          )}

          <div className="mb-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
              <div className="font-semibold text-slate-100">Locker Mode</div>
              <div className="mt-2 text-sm text-slate-400">
                ₱25 for 10 hours. Extra ₱15 is added per extra hour after the
                included time.
              </div>
              <Badge className="mt-3" color="blue">
                ₱25
              </Badge>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
              <div className="font-semibold text-slate-100">Disinfect Mode</div>
              <div className="mt-2 text-sm text-slate-400">
                ₱25 sanitation support. After sanitation is finished, the rider
                has 30 minutes to retrieve the helmet. Extra ₱10 is added every
                30 minutes if left unattended.
              </div>
              <Badge className="mt-3" color="blue">
                ₱25
              </Badge>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
              <div className="font-semibold text-slate-100">Combined Mode</div>
              <div className="mt-2 text-sm text-slate-400">
                ₱30 for storage and sanitation support. Extra ₱15 is added per
                extra hour after the included 10 hours.
              </div>
              <Badge className="mt-3" color="blue">
                ₱30
              </Badge>
            </div>
          </div>

          {lockers.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-400">
              No lockers found in Firestore.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {lockers.map((locker) => {
                const status = getStatus(locker);
                const available = status === "available";
                const busy = busyLockerId === locker.id;

                return (
                  <div
                    key={locker.id}
                    className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-lg font-semibold">
                          {locker.name ?? locker.id}
                        </div>
                        <div className="text-sm text-slate-400">
                          {locker.location ?? "No location"}
                        </div>
                        <div className="mt-3">
                          <StatusPill status={status} />
                        </div>
                      </div>

                      <Button
                        disabled={!available || !!activeBooking || busy}
                        onClick={() => reserveLocker(locker)}
                      >
                        {busy ? "Reserving..." : "Reserve"}
                      </Button>
                    </div>

                    <div className="mt-4 text-xs text-slate-500">
                      Battery:{" "}
                      {typeof locker.battery === "number"
                        ? `${locker.battery}%`
                        : typeof locker.batteryPct === "number"
                          ? `${locker.batteryPct}%`
                          : "—"}{" "}
                      • Last heartbeat: —
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
