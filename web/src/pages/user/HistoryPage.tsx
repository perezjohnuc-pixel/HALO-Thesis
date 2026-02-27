import React, { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query, where, limit } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useAuth } from "../../lib/auth";
import type { Booking } from "../../lib/types";
import { Card, CardBody, CardHeader } from "../../components/ui";
import StatusPill from "../../components/StatusPill";

export default function HistoryPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Booking[]>([]);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "bookings"),
      where("userId", "==", user.uid),
      orderBy("createdAt", "desc"),
      limit(50)
    );
    const unsub = onSnapshot(q, (snap) => {
      setItems(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Booking[]);
    });
    return () => unsub();
  }, [user]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="text-lg font-semibold">History</div>
          <div className="text-sm text-slate-400">Your recent bookings.</div>
        </CardHeader>
        <CardBody>
          <div className="space-y-2">
            {items.length === 0 && <div className="text-slate-400">No bookings yet.</div>}
            {items.map((b) => (
              <div key={b.id} className="flex items-center justify-between rounded-xl border border-slate-800 p-3">
                <div>
                  <div className="font-semibold">Locker: {b.lockerId}</div>
                  <div className="text-xs text-slate-400">Created: {b.createdAt?.toDate?.().toLocaleString?.() ?? "—"}</div>
                </div>
                <StatusPill status={b.status} />
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
