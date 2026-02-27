import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  where,
  limit
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useAuth } from "../../lib/auth";
import type { Booking, Locker } from "../../lib/types";
import { Button, Card, CardBody, CardHeader, Label, Badge } from "../../components/ui";
import StatusPill from "../../components/StatusPill";
import { useNavigate } from "react-router-dom";

// Fixed demo pricing + duration (per your thesis flow)
const DEFAULT_AMOUNT = 25; // PHP
const FIXED_DURATION_MIN = 3; // minutes (used after payment)
const SPARK_DEMO = String(import.meta.env.VITE_SPARK_DEMO || "").toLowerCase() === "true";

function clientQrToken() {
  return `spark-${Math.random().toString(36).slice(2, 12)}`;
}

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
      alert("You already have an active/held booking.");
      navigate("/app/booking");
      return;
    }
    setBusy(true);
    try {
      const now = Date.now();
      const scanDeadline = Timestamp.fromMillis(now + 3 * 60 * 1000);
      await addDoc(collection(db, "bookings"), {
        userId: user.uid,
        lockerId,
        status: "reserved",
        // Fixed (non-editable) duration
        durationMin: FIXED_DURATION_MIN,
        amount: DEFAULT_AMOUNT,
        createdAt: serverTimestamp(),
        startAt: serverTimestamp(),
        ...(SPARK_DEMO
          ? {
              qrToken: clientQrToken(),
              qrExpiresAt: scanDeadline,
              holdExpiresAt: scanDeadline,
            }
          : {})
      } as any);
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
                Choose an available locker. You will have <b>3 minutes</b> to scan the QR at the locker,
                then <b>2 minutes</b> to complete payment.
              </div>
            </div>
            {myBooking ? (
              <Badge color="yellow">You have an active booking</Badge>
            ) : (
              <Badge color="green">No active booking</Badge>
            )}
          </div>
        </CardHeader>
        <CardBody>
          <div className="text-sm text-slate-300">
            Session duration is fixed to <b>{FIXED_DURATION_MIN} minutes</b> (not adjustable).
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
                  <Button
                    disabled={!canReserve || busy}
                    onClick={() => reserve(l.id)}
                    title={
                      myBooking
                        ? "Finish/cancel your current booking first"
                        : l.data.status !== "available"
                          ? "Not available"
                          : "Reserve"
                    }
                  >
                    Reserve
                  </Button>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {sorted.length === 0 && (
        <div className="text-sm text-slate-400">No lockers found. Ask admin to add lockers in Admin → Lockers.</div>
      )}
    </div>
  );
}
