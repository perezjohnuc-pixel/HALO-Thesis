import React, { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where, limit } from "firebase/firestore";
import { Link } from "react-router-dom";
import { db } from "../../lib/firebase";
import { useAuth } from "../../lib/auth";
import type { Booking, Locker } from "../../lib/types";
import { Button, Card, CardBody, CardHeader, Badge } from "../../components/ui";
import StatusPill from "../../components/StatusPill";

export default function UserHome() {
  const { user } = useAuth();
  const [lockers, setLockers] = useState<Array<{ id: string; data: Locker }>>([]);
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

  const available = useMemo(() => lockers.filter((l) => (l.data.status ?? "available") === "available").length, [lockers]);

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold">Lockers</div>
              <div className="text-sm text-slate-400">Real-time availability</div>
            </div>
            <Badge color={available > 0 ? "green" : "red"}>{available} available</Badge>
          </CardHeader>
          <CardBody className="flex items-center justify-between">
            <div className="text-sm text-slate-300">
              Total: <span className="font-semibold text-slate-100">{lockers.length}</span>
            </div>
            <Link to="/app/lockers">
              <Button variant="secondary">View lockers</Button>
            </Link>
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold">My booking</div>
              <div className="text-sm text-slate-400">Scan → Pay → Disinfect</div>
            </div>
            <StatusPill status={myBooking?.data.status ?? "none"} />
          </CardHeader>
          <CardBody className="flex items-center justify-between">
            <div className="text-sm text-slate-300">
              {myBooking ? (
                <>
                  Locker: <span className="font-semibold text-slate-100">{myBooking.data.lockerId}</span>
                </>
              ) : (
                <>No active booking</>
              )}
            </div>
            <Link to="/app/booking">
              <Button>{myBooking ? "Open" : "Reserve"}</Button>
            </Link>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="text-lg font-semibold">Demo-ready user guide</div>
          <div className="text-sm text-slate-400">Use this script during your presentation for a realistic flow</div>
        </CardHeader>
        <CardBody className="text-sm text-slate-300 space-y-2">
          <div>1) Reserve a locker, then scan the locker QR within <span className="font-semibold text-slate-100">3 minutes</span>.</div>
          <div>2) Complete payment within <span className="font-semibold text-slate-100">2 minutes</span> (cash or e-wallet).</div>
          <div>3) Place helmet on the rack with chin strap loose. Keep vents unobstructed for better circulation.</div>
          <div>4) Before starting sanitation, open the visor to a <span className="font-semibold text-slate-100">half-open position (about 2–3 cm)</span> so mist and airflow can enter the face area.</div>
          <div>5) Run sanitation in sequence <span className="font-semibold text-slate-100">Mist → Dryer → UV‑C</span> for balanced disinfection and drying.</div>
          <div>6) Wait for <span className="font-semibold text-slate-100">Program complete</span> before unlocking to avoid interrupting UV‑C exposure time.</div>
        </CardBody>
      </Card>
    </div>
  );
}
