import React, { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardBody, CardHeader } from "../../components/ui";
import { addDoc, collection, doc, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, where, Timestamp } from "firebase/firestore";
import { db } from "../../lib/firebase";
import type { Booking } from "../../lib/types";

function withId<T>(docSnap: any): T & { id: string } {
  return { id: docSnap.id, ...(docSnap.data?.() ?? {}) };
}

function sparkTokenFor(id: string) {
  return `spark-${id.slice(0, 8)}`;
}

const SPARK_DEMO = String(import.meta.env.VITE_SPARK_DEMO || "").toLowerCase() === "true";

export default function AdminDevicesPage() {
  const [bookings, setBookings] = useState<Array<Booking & { id: string }>>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, "bookings"),
      where("status", "in", ["reserved", "pending_payment", "active"]),
      orderBy("createdAt", "desc"),
      limit(30)
    );
    return onSnapshot(q, (snap) => setBookings(snap.docs.map((d) => withId<Booking>(d))));
  }, []);

  const grouped = useMemo(() => ({
    reserved: bookings.filter((b) => b.status === "reserved"),
    pendingPayment: bookings.filter((b) => b.status === "pending_payment"),
    active: bookings.filter((b) => b.status === "active"),
  }), [bookings]);

  async function run(bookingId: string, fn: () => Promise<void>, success: string) {
    setError(null);
    setMsg(null);
    setBusyId(bookingId);
    try {
      await fn();
      setMsg(success);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function moveToPendingPayment(b: Booking & { id: string }) {
    const bookingRef = doc(db, "bookings", b.id);
    const lockerRef = doc(db, "lockers", b.lockerId);
    const deadline = Timestamp.fromMillis(Date.now() + 2 * 60 * 1000);
    await runTransaction(db, async (tx) => {
      tx.update(bookingRef, {
        status: "pending_payment",
        holdExpiresAt: deadline,
        qrUsedAt: serverTimestamp(),
      } as any);
      tx.set(lockerRef, {
        status: "pending_payment",
        pendingPayment: true,
        pendingPaymentExpiresAt: deadline,
        occupied: true,
        currentBookingId: b.id,
      } as any, { merge: true });
      tx.set(doc(collection(db, "logs")), {
        createdAt: serverTimestamp(),
        type: "SPARK_QR_VERIFIED",
        message: "Admin marked booking as QR-verified (pending payment).",
        lockerId: b.lockerId,
        userId: b.userId,
        payload: { bookingId: b.id, token: b.qrToken ?? sparkTokenFor(b.id) },
      } as any);
    });
  }

  async function moveToActive(b: Booking & { id: string }) {
    const bookingRef = doc(db, "bookings", b.id);
    const lockerRef = doc(db, "lockers", b.lockerId);
    const now = Timestamp.now();
    const durationMin = Number((b as any).durationMin ?? 3);
    const endAt = Timestamp.fromMillis(now.toMillis() + Math.max(1, durationMin) * 60 * 1000);
    await runTransaction(db, async (tx) => {
      tx.update(bookingRef, {
        status: "active",
        paidAt: serverTimestamp(),
        activeAt: serverTimestamp(),
        endAt,
        holdExpiresAt: null,
      } as any);
      tx.set(lockerRef, {
        status: "active",
        pendingPayment: false,
        pendingPaymentExpiresAt: null,
      } as any, { merge: true });
      tx.set(doc(collection(db, "logs")), {
        createdAt: serverTimestamp(),
        type: "SPARK_PAYMENT_CONFIRMED",
        message: "Admin confirmed payment and activated booking.",
        lockerId: b.lockerId,
        userId: b.userId,
        payload: { bookingId: b.id },
      } as any);
    });
  }

  async function completeAndRelease(b: Booking & { id: string }) {
    const bookingRef = doc(db, "bookings", b.id);
    const lockerRef = doc(db, "lockers", b.lockerId);
    await runTransaction(db, async (tx) => {
      tx.update(bookingRef, {
        status: "completed",
        completedAt: serverTimestamp(),
      } as any);
      tx.set(lockerRef, {
        status: "available",
        occupied: false,
        currentBookingId: null,
        reservedByUserId: null,
        pendingPayment: false,
        reservationExpiresAt: null,
        pendingPaymentExpiresAt: null,
        lastDisinfectionAt: serverTimestamp(),
      } as any, { merge: true });
      tx.set(doc(collection(db, "logs")), {
        createdAt: serverTimestamp(),
        type: "SPARK_BOOKING_COMPLETED",
        message: "Admin completed booking and released locker.",
        lockerId: b.lockerId,
        userId: b.userId,
        payload: { bookingId: b.id },
      } as any);
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Admin Operations</div>
            <div className="text-sm text-slate-400">Simple action board for Spark mode: no raw API payloads needed.</div>
          </div>
          <Badge color={SPARK_DEMO ? "green" : "yellow"}>{SPARK_DEMO ? "Spark mode" : "Function mode"}</Badge>
        </CardHeader>
        <CardBody className="space-y-2">
          <div className="text-xs text-slate-400">
            Lifecycle: <span className="text-slate-200">Reserved → Pending payment → Active → Completed</span>
          </div>
          {error ? <div className="text-sm text-red-300">{error}</div> : null}
          {msg ? <div className="text-sm text-emerald-300">{msg}</div> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="font-semibold">1) Reserved bookings (mark QR scanned)</div>
        </CardHeader>
        <CardBody className="space-y-2">
          {grouped.reserved.map((b) => (
            <div key={b.id} className="rounded-xl border border-slate-800 p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                <div className="font-semibold">{b.id}</div>
                <div className="text-slate-400">Locker: {b.lockerId}</div>
              </div>
              <Button size="sm" disabled={busyId === b.id} onClick={() => run(b.id, () => moveToPendingPayment(b), `Booking ${b.id} is now pending payment.`)}>
                Verify & Unlock
              </Button>
            </div>
          ))}
          {grouped.reserved.length === 0 ? <div className="text-sm text-slate-400">No reserved bookings.</div> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="font-semibold">2) Pending payment (mark paid)</div>
        </CardHeader>
        <CardBody className="space-y-2">
          {grouped.pendingPayment.map((b) => (
            <div key={b.id} className="rounded-xl border border-slate-800 p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                <div className="font-semibold">{b.id}</div>
                <div className="text-slate-400">Locker: {b.lockerId}</div>
              </div>
              <Button size="sm" disabled={busyId === b.id} onClick={() => run(b.id, () => moveToActive(b), `Booking ${b.id} is now active.`)}>
                Confirm payment
              </Button>
            </div>
          ))}
          {grouped.pendingPayment.length === 0 ? <div className="text-sm text-slate-400">No pending-payment bookings.</div> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="font-semibold">3) Active bookings (complete and release)</div>
        </CardHeader>
        <CardBody className="space-y-2">
          {grouped.active.map((b) => (
            <div key={b.id} className="rounded-xl border border-slate-800 p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                <div className="font-semibold">{b.id}</div>
                <div className="text-slate-400">Locker: {b.lockerId}</div>
              </div>
              <Button size="sm" variant="secondary" disabled={busyId === b.id} onClick={() => run(b.id, () => completeAndRelease(b), `Booking ${b.id} completed and locker released.`)}>
                Complete & Release
              </Button>
            </div>
          ))}
          {grouped.active.length === 0 ? <div className="text-sm text-slate-400">No active bookings.</div> : null}
        </CardBody>
      </Card>
    </div>
  );
}
