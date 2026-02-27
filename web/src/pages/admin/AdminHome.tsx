import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, CardBody, CardHeader } from "../../components/ui";
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
    const reservedLockers = lockers.filter((l) => l.status === "reserved").length;
    const pendingPaymentLockers = lockers.filter((l) => l.status === "pending_payment").length;
    const activeLockers = lockers.filter((l) => l.status === "active").length;
    const occupiedLockers = lockers.filter((l) => ["reserved", "pending_payment", "active", "occupied"].includes(l.status as any)).length;
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
      reservedLockers,
      pendingPaymentLockers,
      activeLockers,
      reserved: byStatus.reserved ?? 0,
      pendingPayment: byStatus.pending_payment ?? 0,
      active: byStatus.active ?? 0,
      completed: byStatus.completed ?? 0,
      expired: byStatus.expired ?? 0,
      cancelled: byStatus.cancelled ?? 0,
      failed: byStatus.failed ?? 0,
    };
  }, [lockers, bookings]);

  const alerts = useMemo(() => {
    const now = Date.now();
    const toMs = (ts: any): number | null => {
      if (!ts) return null;
      if (typeof ts.toMillis === "function") return ts.toMillis();
      if (typeof ts.seconds === "number") return ts.seconds * 1000;
      return null;
    };

    const overdueBookings = bookings
      .map((b) => {
        const hold = toMs((b as any).holdExpiresAt);
        const end = toMs((b as any).endAt);
        const overdueMs =
          (b.status === "reserved" || b.status === "pending_payment") && hold ? now - hold : b.status === "active" && end ? now - end : 0;
        return { ...b, overdueMs };
      })
      .filter((b: any) => typeof b.overdueMs === "number" && b.overdueMs > 0)
      .sort((a: any, b: any) => b.overdueMs - a.overdueMs)
      .slice(0, 8);

    const badLockers = lockers.filter((l) => l.status === "offline" || l.status === "error").slice(0, 8);

    return { overdueBookings, badLockers };
  }, [bookings, lockers]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardBody>
            <div className="text-xs text-slate-400">Total lockers</div>
            <div className="mt-1 text-2xl font-semibold">{stats.totalLockers}</div>
            <div className="mt-2 text-xs text-slate-400">
              Available: {stats.availableLockers} · In-use: {stats.occupiedLockers}
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

      {(alerts.overdueBookings.length > 0 || alerts.badLockers.length > 0) && (
        <Card>
          <CardHeader className="flex items-center justify-between gap-3">
            <div>
              <div className="text-base font-semibold">Alerts / action needed</div>
              <div className="text-sm text-slate-400">
                Helps you spot stuck sessions (common on Emulator if scheduled expiry isn’t running).
              </div>
            </div>
            <Badge color="amber">{alerts.overdueBookings.length + alerts.badLockers.length} items</Badge>
          </CardHeader>
          <CardBody className="space-y-4">
            {alerts.overdueBookings.length > 0 && (
              <div>
                <div className="text-sm font-semibold text-slate-200">Overdue bookings</div>
                <div className="mt-2 divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/30">
                  {alerts.overdueBookings.map((b: any) => (
                    <div key={b.id} className="p-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm text-slate-200">
                        <span className="font-mono text-xs">{b.id}</span>
                        <span className="text-slate-500"> · </span>
                        <span className="font-semibold">{b.status}</span>
                        <span className="text-slate-500"> · locker </span>
                        <span className="text-slate-200">{b.lockerId}</span>
                      </div>
                      <Badge color="red">overdue</Badge>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-xs text-slate-400">
                  Tip: go to <b>Admin → Devices</b> and run <b>expiry now</b> to release stuck lockers.
                </div>
              </div>
            )}

            {alerts.badLockers.length > 0 && (
              <div>
                <div className="text-sm font-semibold text-slate-200">Offline / error lockers</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {alerts.badLockers.map((l) => (
                    <Badge key={(l as any).id} color="red">
                      {(l as any).name ?? (l as any).id}: {l.status}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Link to="/admin/devices">
                <Button variant="secondary" size="sm">Open Devices console</Button>
              </Link>
              <Link to="/admin/logs">
                <Button variant="secondary" size="sm">View logs</Button>
              </Link>
              <Link to="/admin/lockers">
                <Button variant="secondary" size="sm">Manage lockers</Button>
              </Link>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Recent events</h2>
            <div className="text-xs text-slate-400">last {logs.length} logs</div>
          </div>
          <Link to="/admin/logs">
            <Button variant="secondary" size="sm">Open logs</Button>
          </Link>
        </CardHeader>
        <CardBody>
          <div className="divide-y divide-slate-800">
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
