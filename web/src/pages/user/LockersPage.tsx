import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  where,
  limit,
  doc,
  setDoc,
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useAuth } from "../../lib/auth";
import type { Booking, Locker } from "../../lib/types";
import { Button, Card, CardBody, CardHeader, Badge } from "../../components/ui";
import StatusPill from "../../components/StatusPill";
import { useNavigate } from "react-router-dom";

// Temporary thesis flow
const DEFAULT_AMOUNT = 25; // PHP
const FIXED_DURATION_MIN = 3; // after payment / demo session

export default function LockersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [lockers, setLockers] = useState<Array<{ id: string; data: Locker }>>([]);
  const [busy, setBusy] = useState(false);
  const [myBooking, setMyBooking] = useState<{ id: string; data: Booking } | null>(null);

  useEffect(() => {
    const q = query(collection(db, "lockers"));
    return onSnapshot(q, (snap) => {
      setLockers(snap.docs.map((d) => ({ id: d.id, data: d.data() as Locker })));
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "bookings"),
      where("userId", "==", user.uid),
      where("status", "in", ["reserved", "pending_payment", "active"]),
      limit(1)
    );

    return onSnapshot(q, (snap) => {
      const d = snap.docs[0];
      setMyBooking(d ? ({ id: d.id, data: d.data() as Booking } as any) : null);
    });
  }, [user]);

  const sorted = useMemo(() => {
    return [...lockers].sort((a, b) => (a.data.name ?? a.id).localeCompare(b.data.name ?? b.id));
  }, [lockers]);

  async function reserve(lockerId: string) {
    if (!user) return;

    if (myBooking) {
      alert("You already have an active or ongoing booking.");
      navigate("/app/booking");
      return;
    }

    setBusy(true);
    try {
      const now = Date.now();
      const paymentDeadline = Timestamp.fromMillis(now + 3 * 60 * 1000);

      const bookingRef = doc(collection(db, "bookings"));
      const bookingId = bookingRef.id;

      await setDoc(bookingRef, {
        userId: user.uid,
        lockerId,
        status: "pending_payment",
        durationMin: FIXED_DURATION_MIN,
        amount: DEFAULT_AMOUNT,
        paymentMethod: "cash",
        createdAt: serverTimestamp(),
        startAt: serverTimestamp(),
        paymentRequestedAt: serverTimestamp(),
        holdExpiresAt: paymentDeadline,

        // retrieval/security QR will be used later
        claimQrToken: bookingId,
      } as any);

      // temporary flow: immediately prepare locker for device-side coin payment
      await setDoc(
        doc(db, "lockers", lockerId),
        {
          currentBookingId: bookingId,
          pendingPayment: true,
          occupied: false,
          status: "pending_payment",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      navigate("/app/booking");
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold">Reserve a locker</div>
              <div className="text-sm text-slate-400">
                Choose an available locker, then proceed to <b>cash coin payment</b>.
                After payment is confirmed by the ESP32, the locker will unlock.
              </div>
            </div>

            {myBooking ? (
              <Badge color="yellow">You have an ongoing booking</Badge>
            ) : (
              <Badge color="green">No active booking</Badge>
            )}
          </div>
        </CardHeader>

        <CardBody>
          <div className="space-y-2 text-sm text-slate-300">
            <div>
              Payment method: <b>Cash (coins) only</b>
            </div>
            <div>
              Required amount: <b>₱{DEFAULT_AMOUNT}</b>
            </div>
            <div>
              Retrieval security: your <b>personal QR code</b> will be used later when reclaiming the locker.
            </div>
          </div>
        </CardBody>
      </Card>

      {myBooking ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">Your current booking</div>
                <div className="text-sm text-slate-400">
                  You can only reserve <b>one locker at a time</b>. Continue your current locker session.
                </div>
              </div>
              <StatusPill status={myBooking.data.status} />
            </div>
          </CardHeader>
          <CardBody>
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-slate-300">
                Locker: <span className="font-semibold text-slate-100">{myBooking.data.lockerId}</span>
                <span className="text-slate-500"> · Booking ID: </span>
                <span className="font-mono text-xs text-slate-200">{myBooking.id}</span>
              </div>
              <Button onClick={() => navigate("/app/booking")}>Go to My Booking</Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {sorted.map((l) => {
          const canReserve = l.data.status === "available" && !myBooking;

          return (
            <Card key={l.id}>
              <CardBody>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-base font-semibold">{l.data.name ?? l.id}</div>
                    <div className="text-sm text-slate-400">{l.data.location ?? ""}</div>

                    <div className="mt-2">
                      <StatusPill status={l.data.status} />
                    </div>

                    <div className="mt-3 text-xs text-slate-500">
                      Battery: {l.data.batteryPct ?? "—"}% • Last heartbeat: {l.data.lastHeartbeatAt ? "OK" : "—"}
                    </div>
                  </div>

                  {myBooking ? (
                    <Button variant="secondary" onClick={() => navigate("/app/booking")}>
                      Go to booking
                    </Button>
                  ) : (
                    <Button
                      disabled={!canReserve || busy}
                      onClick={() => reserve(l.id)}
                      title={l.data.status !== "available" ? "Not available" : "Reserve locker"}
                    >
                      Reserve
                    </Button>
                  )}
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {sorted.length === 0 && (
        <div className="text-sm text-slate-400">
          No lockers found. Ask admin to add lockers in Admin → Lockers.
        </div>
      )}
    </div>
  );
}