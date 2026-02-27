import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { Card, CardBody } from "../../components/ui";
import { db } from "../../lib/firebase";
import type { Booking, Locker, LogEvent } from "../../lib/types";

function withId<T>(doc: any): T & { id: string } {
  return { id: doc.id, ...(doc.data?.() ?? {}) };
}

export default function AdminHome() {
  const [lockers, setLockers] = useState<Array<Locker & { id: string }>>([]);
  const [bookings, setBookings] = useState<Array<Booking & { id: string }>>([]);
  const [logs, setLogs] = useState<Array<LogEvent & { id: string }>>([]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "lockers"), (snap) => {
      setLockers(snap.docs.map((d) => withId<Locker>(d)));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(collection(db, "bookings"), orderBy("createdAt", "desc"), limit(100));
    const unsub = onSnapshot(q, (snap) => {
      setBookings(snap.docs.map((d) => withId<Booking>(d)));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(collection(db, "logs"), orderBy("createdAt", "desc"), limit(40));
    const unsub = onSnapshot(q, (snap) => {
      setLogs(snap.docs.map((d) => withId<LogEvent>(d)));
    });
    return () => unsub();
  }, []);

  const stats = useMemo(() => {
    const totalLockers = lockers.length;
    const availableLockers = lockers.filter((l) => l.status === "available").length;
    const occupiedLockers = lockers.filter((l) => l.status === "occupied").length;
    const offlineOrError = lockers.filter((l) => l.status === "offline" || l.status === "error").length;

    const byStatus = bookings.reduce<Record<string, number>>((acc, b) => {
      const s = b.status ?? "unknown";
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    }, {});

    return {
      totalLockers,
      availableLockers,
      occupiedLockers,
      offlineOrError,
      reserved: byStatus.reserved ?? 0,
      pendingPayment: byStatus.pending_payment ?? 0,
      active: byStatus.active ?? 0,
      completed: byStatus.completed ?? 0,
      expired: byStatus.expired ?? 0,
      cancelled: byStatus.cancelled ?? 0,
      failed: byStatus.failed ?? 0,
    };
  }, [lockers, bookings]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardBody>
            <div className="text-xs text-slate-400">Total lockers</div>
            <div className="mt-1 text-2xl font-semibold">{stats.totalLockers}</div>
            <div className="mt-2 text-xs text-slate-400">
              Available: {stats.availableLockers} · Occupied: {stats.occupiedLockers}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-xs text-slate-400">Bookings awaiting scan</div>
            <div className="mt-1 text-2xl font-semibold">{stats.reserved}</div>
            <div className="mt-2 text-xs text-slate-400">3-min scan window</div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-xs text-slate-400">Awaiting payment</div>
            <div className="mt-1 text-2xl font-semibold">{stats.pendingPayment}</div>
            <div className="mt-2 text-xs text-slate-400">2-min payment window</div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-xs text-slate-400">Active sessions</div>
            <div className="mt-1 text-2xl font-semibold">{stats.active}</div>
            <div className="mt-2 text-xs text-slate-400">UV-C starts after payment</div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardBody>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-base font-semibold">Recent events</h2>
            <div className="text-xs text-slate-400">last {logs.length} logs</div>
          </div>
          <div className="mt-4 divide-y divide-slate-800">
            {logs.map((l) => (
              <div key={l.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-200">{l.type}</div>
                  <div className="text-xs text-slate-500">{l.lockerId ?? "—"}</div>
                </div>
                <div className="mt-1 text-sm text-slate-300">{l.message}</div>
              </div>
            ))}
            {logs.length === 0 && <div className="py-6 text-sm text-slate-400">No logs yet.</div>}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
