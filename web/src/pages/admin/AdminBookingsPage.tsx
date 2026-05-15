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
  writeBatch,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  Input,
  Select,
} from "../../components/ui";
import StatusPill from "../../components/StatusPill";
import { db } from "../../lib/firebase";
import type { Booking, BookingStatus, ServiceType } from "../../lib/types";

function withId<T>(d: any): T & { id: string } {
  return { id: d.id, ...(d.data?.() ?? {}) };
}

function fmt(ts?: any) {
  const ms = ts?.toMillis?.();
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

function makeToken() {
  const g = globalThis as any;

  if (g.crypto?.randomUUID) {
    return g.crypto.randomUUID();
  }

  return `retrieval_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function amountForService(serviceType: ServiceType) {
  if (serviceType === "combined") return 30;
  return 25;
}

function durationForService(serviceType: ServiceType) {
  if (serviceType === "disinfect_only") return 30;
  return 600;
}

function selectedModesForService(serviceType: ServiceType) {
  if (serviceType === "locker_only") return ["locker"];
  if (serviceType === "disinfect_only") return ["mist", "fan", "uvc"];
  return ["locker", "mist", "fan", "uvc"];
}

async function addLog(input: {
  type: string;
  message: string;
  lockerId?: string | null;
  bookingId?: string | null;
  userId?: string | null;
  payload?: any;
}) {
  await addDoc(collection(db, "logs"), {
    ...input,
    createdAt: serverTimestamp(),
  });
}

const STATUS_OPTIONS: Array<{ value: BookingStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "awaiting_booking_qr", label: "Awaiting booking QR" },
  { value: "confirmed", label: "Confirmed" },
  { value: "mode_selected", label: "Mode selected" },
  { value: "waiting_for_helmet", label: "Waiting for helmet" },
  { value: "in_use", label: "In use" },
  { value: "disinfecting", label: "Disinfecting" },
  { value: "awaiting_payment", label: "Awaiting payment" },
  { value: "awaiting_retrieval_qr", label: "Awaiting retrieval QR" },
  { value: "retrieval_verified", label: "Retrieval verified" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "expired", label: "Expired" },
  { value: "failed", label: "Failed" },
];

export default function AdminBookingsPage() {
  const [bookings, setBookings] = useState<Array<Booking & { id: string }>>([]);
  const [status, setStatus] = useState<BookingStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, "bookings"),
      orderBy("createdAt", "desc"),
      limit(250)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setBookings(snap.docs.map((d) => withId<Booking>(d)));
      },
      (e) => setErr(e.message)
    );

    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();

    return bookings
      .filter((b) => (status === "all" ? true : b.status === status))
      .filter((b) => {
        if (!s) return true;

        return (
          (b.userId ?? "").toLowerCase().includes(s) ||
          (b.lockerId ?? "").toLowerCase().includes(s) ||
          (b.id ?? "").toLowerCase().includes(s) ||
          (b.serviceType ?? "").toLowerCase().includes(s)
        );
      });
  }, [bookings, status, search]);

  async function confirmBookingQr(b: Booking & { id: string }) {
    if (!b.lockerId) return;

    setBusy(b.id);
    setErr(null);

    try {
      const batch = writeBatch(db);

      batch.update(doc(db, "bookings", b.id), {
        status: "confirmed",
        bookingQrVerified: true,
        bookingQrVerifiedAt: serverTimestamp(),
        programStep: "choose_mode",
        updatedAt: serverTimestamp(),
        deviceStatus: {
          lock: false,
          mist: false,
          fan: false,
          uvc: false,
        },
      } as any);

      batch.update(doc(db, "lockers", b.lockerId), {
        status: "confirmed",
        occupied: true,
        pendingPayment: false,
        currentBookingId: b.id,
        reservedByUserId: b.userId ?? null,
        updatedAt: serverTimestamp(),
      } as any);

      await batch.commit();

      await addLog({
        type: "ADMIN_OVERRIDE",
        bookingId: b.id,
        lockerId: b.lockerId,
        userId: b.userId,
        message: "Admin manually confirmed the booking QR and unlocked initial access.",
      });
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  async function selectMode(b: Booking & { id: string }, serviceType: ServiceType) {
    setBusy(b.id);
    setErr(null);

    try {
      await updateDoc(doc(db, "bookings", b.id), {
        status: "mode_selected",
        serviceType,
        selectedModes: selectedModesForService(serviceType),
        amountDue: amountForService(serviceType),
        durationMin: durationForService(serviceType),
        programStep: "waiting_for_helmet",
        updatedAt: serverTimestamp(),
      } as any);

      await addLog({
        type: "ADMIN_OVERRIDE",
        bookingId: b.id,
        lockerId: b.lockerId,
        userId: b.userId,
        message: `Admin manually selected mode: ${serviceType}.`,
      });
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  async function markHelmetReady(b: Booking & { id: string }) {
    setBusy(b.id);
    setErr(null);

    try {
      await updateDoc(doc(db, "bookings", b.id), {
        status: "mode_selected",
        helmetDetected: true,
        doorClosed: true,
        helmetDetectedAt: serverTimestamp(),
        doorClosedAt: serverTimestamp(),
        programStep: "ready_to_start",
        updatedAt: serverTimestamp(),
      } as any);

      await addLog({
        type: "ADMIN_OVERRIDE",
        bookingId: b.id,
        lockerId: b.lockerId,
        userId: b.userId,
        message: "Admin manually marked helmet detected and door closed.",
      });
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  async function startSelectedMode(b: Booking & { id: string }) {
    if (!b.lockerId) return;

    setBusy(b.id);
    setErr(null);

    try {
      const serviceType = (b.serviceType ?? "locker_only") as ServiceType;
      const batch = writeBatch(db);

      const commonPatch = {
        programStarted: true,
        programStartedAt: serverTimestamp(),
        selectedModes: selectedModesForService(serviceType),
        sequenceName: serviceType,
        updatedAt: serverTimestamp(),
      };

      if (serviceType === "locker_only") {
        batch.update(doc(db, "bookings", b.id), {
          ...commonPatch,
          status: "in_use",
          programFinished: true,
          programFinishedAt: serverTimestamp(),
          programStep: "locker_locked",
          deviceStatus: {
            lock: true,
            mist: false,
            fan: false,
            uvc: false,
          },
        } as any);

        batch.update(doc(db, "lockers", b.lockerId), {
          status: "in_use",
          occupied: true,
          pendingPayment: false,
          updatedAt: serverTimestamp(),
        } as any);
      } else {
        const programRunId = makeToken();

        batch.update(doc(db, "bookings", b.id), {
          ...commonPatch,
          status: "disinfecting",
          programRunId,
          programFinished: false,
          programStep: "mist",
          deviceStatus: {
            lock: true,
            mist: true,
            fan: false,
            uvc: false,
          },
        } as any);

        batch.update(doc(db, "lockers", b.lockerId), {
          status: "disinfecting",
          occupied: true,
          pendingPayment: false,
          updatedAt: serverTimestamp(),
        } as any);

        batch.set(doc(db, "deviceCommands", `program_${b.id}`), {
          createdAt: serverTimestamp(),
          lockerId: b.lockerId,
          type: "sanitation_program",
          status: "queued",
          payload: {
            bookingId: b.id,
            programRunId,
            sequenceName: serviceType,
            steps: [
              { id: "mist", label: "Mist Pump", order: 0, seconds: 10 },
              { id: "fan", label: "Fan", order: 1, seconds: 30 },
              { id: "uvc", label: "UV-C", order: 2, seconds: 30 },
            ],
          },
        });
      }

      await batch.commit();

      await addLog({
        type: "ADMIN_OVERRIDE",
        bookingId: b.id,
        lockerId: b.lockerId,
        userId: b.userId,
        message: `Admin manually started ${serviceType}.`,
      });
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  async function moveToPayment(b: Booking & { id: string }) {
    if (!b.lockerId) return;

    setBusy(b.id);
    setErr(null);

    try {
      const batch = writeBatch(db);

      batch.update(doc(db, "bookings", b.id), {
        status: "awaiting_payment",
        programFinished: true,
        programFinishedAt: serverTimestamp(),
        programStep: "awaiting_payment",
        paymentStatus: "unpaid",
        paymentConfirmed: false,
        updatedAt: serverTimestamp(),
        deviceStatus: {
          lock: true,
          mist: false,
          fan: false,
          uvc: false,
        },
      } as any);

      batch.update(doc(db, "lockers", b.lockerId), {
        status: "awaiting_payment",
        pendingPayment: true,
        occupied: true,
        updatedAt: serverTimestamp(),
      } as any);

      await batch.commit();

      await addLog({
        type: "ADMIN_OVERRIDE",
        bookingId: b.id,
        lockerId: b.lockerId,
        userId: b.userId,
        message: "Admin manually moved booking to awaiting payment.",
      });
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  async function confirmPayment(b: Booking & { id: string }) {
    if (!b.lockerId) return;

    setBusy(b.id);
    setErr(null);

    try {
      const requiredAmount =
        typeof b.amountDue === "number" && b.amountDue > 0
          ? b.amountDue
          : amountForService((b.serviceType ?? "locker_only") as ServiceType);

      const retrievalQrToken = makeToken();
      const paymentRef = doc(collection(db, "payments"));
      const batch = writeBatch(db);

      batch.set(paymentRef, {
        createdAt: serverTimestamp(),
        userId: b.userId ?? null,
        bookingId: b.id,
        lockerId: b.lockerId,
        provider: "cash",
        paymentMethod: "admin_override",
        rawPayload: `ADMIN_PAYMENT_${Date.now()}`,
        status: "paid",
        deviceId: "ADMIN",
        amountPaid: requiredAmount,
        requiredAmount,
      });

      batch.update(doc(db, "bookings", b.id), {
        status: "awaiting_retrieval_qr",
        paidAt: serverTimestamp(),
        paymentId: paymentRef.id,
        paymentConfirmed: true,
        paymentStatus: "paid",
        paymentProvider: "cash",
        paymentPayload: `ADMIN_PAYMENT_${Date.now()}`,
        amountPaid: requiredAmount,
        retrievalQrGenerated: true,
        retrievalQrToken,
        retrievalQrVerified: false,
        retrievalQrVerifiedAt: null,
        programStep: "awaiting_retrieval",
        updatedAt: serverTimestamp(),
        deviceStatus: {
          lock: true,
          mist: false,
          fan: false,
          uvc: false,
        },
      } as any);

      batch.update(doc(db, "lockers", b.lockerId), {
        status: "awaiting_retrieval",
        pendingPayment: false,
        occupied: true,
        lastPaymentAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } as any);

      await batch.commit();

      await addLog({
        type: "ADMIN_OVERRIDE",
        bookingId: b.id,
        lockerId: b.lockerId,
        userId: b.userId,
        message: "Admin manually confirmed payment and generated retrieval QR.",
      });
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  async function verifyRetrievalQr(b: Booking & { id: string }) {
    if (!b.lockerId) return;

    setBusy(b.id);
    setErr(null);

    try {
      const batch = writeBatch(db);

      batch.update(doc(db, "bookings", b.id), {
        status: "retrieval_verified",
        retrievalQrVerified: true,
        retrievalQrVerifiedAt: serverTimestamp(),
        programStep: "open",
        updatedAt: serverTimestamp(),
        deviceStatus: {
          lock: false,
          mist: false,
          fan: false,
          uvc: false,
        },
      } as any);

      batch.update(doc(db, "lockers", b.lockerId), {
        status: "awaiting_retrieval",
        occupied: true,
        pendingPayment: false,
        updatedAt: serverTimestamp(),
      } as any);

      await batch.commit();

      await addLog({
        type: "ADMIN_OVERRIDE",
        bookingId: b.id,
        lockerId: b.lockerId,
        userId: b.userId,
        message: "Admin manually verified retrieval QR and unlocked the locker.",
      });
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  async function markHelmetRemoved(b: Booking & { id: string }) {
    setBusy(b.id);
    setErr(null);

    try {
      await updateDoc(doc(db, "bookings", b.id), {
        helmetDetected: false,
        helmetDetectedAt: null,
        updatedAt: serverTimestamp(),
      } as any);

      await addLog({
        type: "ADMIN_OVERRIDE",
        bookingId: b.id,
        lockerId: b.lockerId,
        userId: b.userId,
        message: "Admin manually marked helmet as removed.",
      });
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  async function completeAndRelease(b: Booking & { id: string }) {
    if (!b.lockerId) return;

    setBusy(b.id);
    setErr(null);

    try {
      const batch = writeBatch(db);

      batch.update(doc(db, "bookings", b.id), {
        status: "completed",
        completedAt: serverTimestamp(),
        programStep: "completed",
        programFinished: true,
        updatedAt: serverTimestamp(),
        deviceStatus: {
          lock: true,
          mist: false,
          fan: false,
          uvc: false,
        },
      } as any);

      batch.update(doc(db, "lockers", b.lockerId), {
        status: "available",
        occupied: false,
        currentBookingId: null,
        reservedByUserId: null,
        pendingPayment: false,
        reservationExpiresAt: null,
        pendingPaymentExpiresAt: null,
        lastCompletedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } as any);

      await batch.commit();

      await addLog({
        type: "ADMIN_OVERRIDE",
        bookingId: b.id,
        lockerId: b.lockerId,
        userId: b.userId,
        message: "Admin completed booking and released locker.",
      });
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  async function cancelAndRelease(b: Booking & { id: string }) {
    if (!b.lockerId) return;

    setBusy(b.id);
    setErr(null);

    try {
      const batch = writeBatch(db);

      batch.update(doc(db, "bookings", b.id), {
        status: "cancelled",
        cancelledAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        programStep: "admin_cancelled",
        deviceStatus: {
          lock: true,
          mist: false,
          fan: false,
          uvc: false,
        },
      } as any);

      batch.update(doc(db, "lockers", b.lockerId), {
        status: "available",
        occupied: false,
        currentBookingId: null,
        reservedByUserId: null,
        pendingPayment: false,
        reservationExpiresAt: null,
        pendingPaymentExpiresAt: null,
        updatedAt: serverTimestamp(),
      } as any);

      await batch.commit();

      await addLog({
        type: "ADMIN_OVERRIDE",
        bookingId: b.id,
        lockerId: b.lockerId,
        userId: b.userId,
        message: "Admin cancelled booking and released locker.",
      });
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardBody>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-base font-semibold">Bookings</h2>
              <div className="mt-1 text-xs text-slate-400">
                Latest 250 bookings. Use this page for admin overrides during testing or defense.
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>

              <Input
                placeholder="Search bookingId / lockerId / userId / mode"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {err && <div className="mt-3 text-sm text-red-300">{err}</div>}
        </CardBody>
      </Card>

      <div className="grid gap-4">
        {filtered.map((b) => (
          <Card key={b.id}>
            <CardBody>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold text-slate-100">
                        {b.id}
                      </div>
                      <StatusPill status={b.status} />
                    </div>

                    <div className="mt-1 text-xs text-slate-400">
                      Locker:{" "}
                      <span className="text-slate-200">{b.lockerId}</span> · User:{" "}
                      <span className="text-slate-200">{b.userId}</span>
                    </div>

                    <div className="mt-1 text-xs text-slate-500">
                      Created: {fmt(b.createdAt)} · Paid: {fmt(b.paidAt)} · Completed:{" "}
                      {fmt(b.completedAt)}
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <Badge color="blue">
                        Mode: {b.serviceType ?? "not selected"}
                      </Badge>
                      <Badge color={b.bookingQrVerified ? "green" : "amber"}>
                        Booking QR: {b.bookingQrVerified ? "verified" : "not verified"}
                      </Badge>
                      <Badge color={b.paymentStatus === "paid" ? "green" : "amber"}>
                        Payment: {b.paymentStatus ?? "unpaid"}
                      </Badge>
                      <Badge color={b.retrievalQrVerified ? "green" : "amber"}>
                        Retrieval QR:{" "}
                        {b.retrievalQrVerified ? "verified" : "not verified"}
                      </Badge>
                      <Badge color={b.helmetDetected ? "green" : "slate"}>
                        Helmet: {b.helmetDetected ? "detected" : "not detected"}
                      </Badge>
                      <Badge color={b.doorClosed ? "green" : "slate"}>
                        Door: {b.doorClosed ? "closed" : "open"}
                      </Badge>
                    </div>

                    <div className="mt-2 text-xs text-slate-400">
                      Amount: ₱{b.amountPaid ?? 0} / ₱{b.amountDue ?? 0} · Step:{" "}
                      {b.programStep ?? "—"}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-3">
                  <div className="mb-2 text-sm font-semibold text-slate-200">
                    Admin override flow
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy === b.id || b.status !== "awaiting_booking_qr"}
                      onClick={() => confirmBookingQr(b)}
                    >
                      Confirm booking QR
                    </Button>

                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy === b.id || b.status !== "confirmed"}
                      onClick={() => selectMode(b, "locker_only")}
                    >
                      Set Locker Mode
                    </Button>

                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy === b.id || b.status !== "confirmed"}
                      onClick={() => selectMode(b, "disinfect_only")}
                    >
                      Set Disinfect Mode
                    </Button>

                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy === b.id || b.status !== "confirmed"}
                      onClick={() => selectMode(b, "combined")}
                    >
                      Set Combined Mode
                    </Button>

                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={
                        busy === b.id ||
                        !["mode_selected", "waiting_for_helmet"].includes(
                          b.status
                        )
                      }
                      onClick={() => markHelmetReady(b)}
                    >
                      Helmet + Door OK
                    </Button>

                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={
                        busy === b.id ||
                        !["mode_selected", "waiting_for_helmet"].includes(
                          b.status
                        )
                      }
                      onClick={() => startSelectedMode(b)}
                    >
                      Start selected mode
                    </Button>

                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={
                        busy === b.id ||
                        !["in_use", "disinfecting"].includes(b.status)
                      }
                      onClick={() => moveToPayment(b)}
                    >
                      Move to payment
                    </Button>

                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy === b.id || b.status !== "awaiting_payment"}
                      onClick={() => confirmPayment(b)}
                    >
                      Confirm payment
                    </Button>

                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={
                        busy === b.id || b.status !== "awaiting_retrieval_qr"
                      }
                      onClick={() => verifyRetrievalQr(b)}
                    >
                      Verify retrieval QR
                    </Button>

                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy === b.id || b.status !== "retrieval_verified"}
                      onClick={() => markHelmetRemoved(b)}
                    >
                      Helmet removed
                    </Button>

                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy === b.id || b.status !== "retrieval_verified"}
                      onClick={() => completeAndRelease(b)}
                    >
                      Complete + release
                    </Button>

                    <Button
                      size="sm"
                      variant="danger"
                      disabled={
                        busy === b.id ||
                        ["completed", "cancelled", "expired", "failed"].includes(
                          b.status
                        )
                      }
                      onClick={() => cancelAndRelease(b)}
                    >
                      Cancel + release
                    </Button>
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>
        ))}

        {filtered.length === 0 && (
          <Card>
            <CardBody>
              <div className="text-sm text-slate-400">
                No bookings matched your filters.
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
