import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
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
  lastHeartbeatAt?: any;
};

type BookingDoc = {
  id: string;
  userId?: string;
  lockerId?: string;
  status?: string;
  amount?: number;
  serviceType?: string;
};

type ServiceType = "locker_only" | "disinfectant" | "combined";

const SERVICE_OPTIONS: {
  id: ServiceType;
  title: string;
  price: number;
  description: string;
  durationMin: number;
}[] = [
  {
    id: "locker_only",
    title: "Locker Only",
    price: 25,
    description: "Use the locker for storage only. Maximum 10 hours.",
    durationMin: 600,
  },
  {
    id: "disinfectant",
    title: "Disinfectant Only",
    price: 25,
    description: "Use the cleaning process only: pump, fan, and UV-C.",
    durationMin: 30,
  },
  {
    id: "combined",
    title: "Combined",
    price: 30,
    description: "Locker storage plus full cleaning process. Maximum 10 hours.",
    durationMin: 600,
  },
];

function getStatus(locker: LockerDoc) {
  if (locker.status) return locker.status;
  if (locker.pendingPayment) return "pending_payment";
  if (locker.occupied) return "active";
  return "available";
}

function getServiceLabel(serviceType: ServiceType) {
  if (serviceType === "locker_only") return "Locker Only";
  if (serviceType === "disinfectant") return "Disinfectant Only";
  if (serviceType === "combined") return "Combined";
  return "Locker Service";
}

export default function LockersPage() {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const navigate = useNavigate();

  const [lockers, setLockers] = useState<LockerDoc[]>([]);
  const [activeBooking, setActiveBooking] = useState<BookingDoc | null>(null);
  const [selectedService, setSelectedService] = useState<ServiceType>("locker_only");
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
      limit(5)
    );

    return onSnapshot(
      q,
      (snap) => {
        const recent = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }) as BookingDoc)
          .find((b) =>
            ["reserved", "pending_payment", "active"].includes(b.status ?? "")
          );

        setActiveBooking(recent ?? null);
      },
      (e) => setErr(e.message)
    );
  }, [uid]);

  const selectedOption = useMemo(() => {
    return SERVICE_OPTIONS.find((s) => s.id === selectedService) ?? SERVICE_OPTIONS[0];
  }, [selectedService]);

  async function reserveLocker(locker: LockerDoc) {
    if (!uid) {
      navigate("/auth/login");
      return;
    }

    const lockerStatus = getStatus(locker);

    if (lockerStatus !== "available") {
      setErr("This locker is not available right now.");
      return;
    }

    if (activeBooking) {
      setErr("You already have an active or pending booking. Please finish or cancel it first.");
      navigate("/app/booking");
      return;
    }

    try {
      setErr(null);
      setBusyLockerId(locker.id);

      const now = new Date();
      const holdExpiresAt = new Date(now.getTime() + 10 * 60 * 1000);

      const bookingRef = await addDoc(collection(db, "bookings"), {
        userId: uid,
        lockerId: locker.id,

        status: "pending_payment",
        paymentMethod: "cash",
        paymentStatus: "pending",
        paymentConfirmed: false,

        serviceType: selectedOption.id,
        amount: selectedOption.price,
        durationMin: selectedOption.durationMin,

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        startAt: serverTimestamp(),
        holdExpiresAt,
        paymentRequestedAt: serverTimestamp(),

        claimQrToken: null,

        helmetDetected: false,
        doorClosed: true,
        programStarted: false,
        programFinished: false,
        programStep: "waiting_payment",
        programStepEndsAt: null,
        retrievalQrVerified: false,

        deviceStatus: {
          lock: true,
          mist: false,
          fan: false,
          uvc: false,
        },
      });

      await updateDoc(doc(db, "lockers", locker.id), {
        status: "pending_payment",
        pendingPayment: true,
        occupied: false,
        currentBookingId: bookingRef.id,
        pendingPaymentExpiresAt: holdExpiresAt,
        reservedByUserId: uid,
        updatedAt: serverTimestamp(),
      });

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
          <div className="text-sm uppercase tracking-wide text-slate-400">Customer</div>
          <div className="text-2xl font-bold">Lockers</div>
          <div className="text-sm text-slate-400">Reserve an available locker</div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-lg font-bold">Reserve a locker</div>
              <div className="text-sm text-slate-400">
                Choose a service, reserve a locker, then pay using the coin slot.
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
              You already have a booking. Go to My Booking to continue payment, control, retrieval, or cancellation.
              <div className="mt-3">
                <Button size="sm" onClick={() => navigate("/app/booking")}>
                  Go to My Booking
                </Button>
              </div>
            </div>
          )}

          <div className="mb-5">
            <div className="mb-2 text-sm font-semibold text-slate-200">
              Choose service type
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {SERVICE_OPTIONS.map((service) => {
                const selected = selectedService === service.id;

                return (
                  <button
                    key={service.id}
                    type="button"
                    onClick={() => setSelectedService(service.id)}
                    className={
                      "rounded-2xl border p-4 text-left transition " +
                      (selected
                        ? "border-cyan-400/60 bg-cyan-500/15"
                        : "border-slate-800 bg-slate-950/40 hover:border-slate-600")
                    }
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-slate-100">{service.title}</div>
                      <Badge color={selected ? "blue" : "slate"}>₱{service.price}</Badge>
                    </div>

                    <div className="mt-2 text-sm text-slate-400">{service.description}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mb-4 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm">
            <div className="font-semibold">Selected service: {getServiceLabel(selectedService)}</div>
            <div className="mt-1 text-slate-400">
              Payment required: <b>₱{selectedOption.price}</b>. Insert 5-peso coins until the required amount is reached.
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
