import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, CardBody, CardHeader } from "../../components/ui";
import { db } from "../../lib/firebase";
import type { Booking, Locker, LogEvent } from "../../lib/types";
import StatusPill from "../../components/StatusPill";

function withId<T>(docSnap: any): T & { id: string } {
  return { id: docSnap.id, ...(docSnap.data?.() ?? {}) };
}

function fmtTs(ts?: any) {
  const ms = ts?.toMillis?.();
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

const ACTIVE_BOOKING_STATUSES = [
  "awaiting_booking_qr",
  "confirmed",
  "mode_selected",
  "waiting_for_helmet",
  "in_use",
  "disinfecting",
  "awaiting_payment",
  "awaiting_retrieval_qr",
  "retrieval_verified",
];

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
    const q = query(collection(db, "bookings"), orderBy("createdAt", "desc"), limit(150));

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
    const bookingByStatus = bookings.reduce<Record<string, number>>((acc, b) => {
      const s = b.status ?? "unknown";
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    }, {});

    const lockerByStatus = lockers.reduce<Record<string, number>>((acc, l) => {
      const s = l.status ?? "unknown";
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    }, {});

    return {
      totalLockers: lockers.length,
      availableLockers: lockerByStatus.available ?? 0,
      reservedLockers: lockerByStatus.reserved ?? 0,
      confirmedLockers: lockerByStatus.confirmed ?? 0,
      inUseLockers: lockerByStatus.in_use ?? 0,
      disinfectingLockers: lockerByStatus.disinfecting ?? 0,
      awaitingPaymentLockers: lockerByStatus.awaiting_payment ?? 0,
      awaitingRetrievalLockers: lockerByStatus.awaiting_retrieval ?? 0,
      maintenanceLockers: lockerByStatus.maintenance ?? 0,
      offlineOrError:
        (lockerByStatus.offline ?? 0) +
        (lockerByStatus.error ?? 0),

      awaitingBookingQr: bookingByStatus.awaiting_booking_qr ?? 0,
      confirmed: bookingByStatus.confirmed ?? 0,
      modeSelected: bookingByStatus.mode_selected ?? 0,
      waitingForHelmet: bookingByStatus.waiting_for_helmet ?? 0,
      inUse: bookingByStatus.in_use ?? 0,
      disinfecting: bookingByStatus.disinfecting ?? 0,
      awaitingPayment: bookingByStatus.awaiting_payment ?? 0,
      awaitingRetrievalQr: bookingByStatus.awaiting_retrieval_qr ?? 0,
      retrievalVerified: bookingByStatus.retrieval_verified ?? 0,
      completed: bookingByStatus.completed ?? 0,
      cancelled: bookingByStatus.cancelled ?? 0,
      failed: bookingByStatus.failed ?? 0,
      activeBookings: bookings.filter((b) =>
        ACTIVE_BOOKING_STATUSES.includes(b.status ?? "")
      ).length,
    };
  }, [bookings, lockers]);

  const alerts = useMemo(() => {
    const badLockers = lockers
      .filter((l) => ["maintenance", "offline", "error"].includes(l.status as string))
      .slice(0, 8);

    const stuckBookings = bookings
      .filter((b) =>
        [
          "awaiting_booking_qr",
          "waiting_for_helmet",
          "awaiting_payment",
          "awaiting_retrieval_qr",
        ].includes(b.status ?? "")
      )
      .slice(0, 8);

    return {
      badLockers,
      stuckBookings,
    };
  }, [bookings, lockers]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardBody>
            <div className="text-xs text-slate-400">Total lockers</div>
            <div className="mt-1 text-2xl font-semibold">{stats.totalLockers}</div>
            <div className="mt-2 text-xs text-slate-400">
              Available: {stats.availableLockers}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="text-xs text-slate-400">Active bookings</div>
            <div className="mt-1 text-2xl font-semibold">{stats.activeBookings}</div>
            <div className="mt-2 text-xs text-slate-400">
              All ongoing booking stages
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="text-xs text-slate-400">Awaiting payment</div>
            <div className="mt-1 text-2xl font-semibold">
              {stats.awaitingPayment}
            </div>
            <div className="mt-2 text-xs text-slate-400">
              Coin slot payment stage
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="text-xs text-slate-400">Maintenance / offline</div>
            <div className="mt-1 text-2xl font-semibold">
              {stats.maintenanceLockers + stats.offlineOrError}
            </div>
            <div className="mt-2 text-xs text-slate-400">
              Lockers unavailable for users
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <div className="font-semibold">Locker status overview</div>
          </CardHeader>
          <CardBody className="flex flex-wrap gap-2">
            <Badge color="green">Available: {stats.availableLockers}</Badge>
            <Badge color="blue">Reserved: {stats.reservedLockers}</Badge>
            <Badge color="blue">Confirmed: {stats.confirmedLockers}</Badge>
            <Badge color="sky">In use: {stats.inUseLockers}</Badge>
            <Badge color="sky">Disinfecting: {stats.disinfectingLockers}</Badge>
            <Badge color="amber">Awaiting payment: {stats.awaitingPaymentLockers}</Badge>
            <Badge color="amber">
              Awaiting retrieval: {stats.awaitingRetrievalLockers}
            </Badge>
            <Badge color="red">Maintenance: {stats.maintenanceLockers}</Badge>
            <Badge color="red">Offline/Error: {stats.offlineOrError}</Badge>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="font-semibold">Booking status overview</div>
          </CardHeader>
          <CardBody className="flex flex-wrap gap-2">
            <Badge color="blue">Booking QR: {stats.awaitingBookingQr}</Badge>
            <Badge color="blue">Confirmed: {stats.confirmed}</Badge>
            <Badge color="blue">Mode selected: {stats.modeSelected}</Badge>
            <Badge color="amber">Waiting helmet: {stats.waitingForHelmet}</Badge>
            <Badge color="sky">In use: {stats.inUse}</Badge>
            <Badge color="sky">Disinfecting: {stats.disinfecting}</Badge>
            <Badge color="amber">Payment: {stats.awaitingPayment}</Badge>
            <Badge color="amber">Retrieval QR: {stats.awaitingRetrievalQr}</Badge>
            <Badge color="green">Completed: {stats.completed}</Badge>
            <Badge color="red">Cancelled: {stats.cancelled}</Badge>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="font-semibold">Quick admin actions</div>
          </CardHeader>
          <CardBody className="flex flex-col gap-2">
            <Link to="/admin/bookings">
              <Button className="w-full" variant="secondary">
                Open booking overrides
              </Button>
            </Link>

            <Link to="/admin/lockers">
              <Button className="w-full" variant="secondary">
                Manage lockers
              </Button>
            </Link>

            <Link to="/admin/devices">
              <Button className="w-full" variant="secondary">
                Open device simulator
              </Button>
            </Link>

            <Link to="/admin/logs">
              <Button className="w-full" variant="secondary">
                View logs
              </Button>
            </Link>
          </CardBody>
        </Card>
      </div>

      {(alerts.badLockers.length > 0 || alerts.stuckBookings.length > 0) && (
        <Card>
          <CardHeader className="flex items-center justify-between gap-3">
            <div>
              <div className="text-base font-semibold">Alerts / action needed</div>
              <div className="text-sm text-slate-400">
                Use the admin override tools if a demo or hardware step gets stuck.
              </div>
            </div>

            <Badge color="amber">
              {alerts.badLockers.length + alerts.stuckBookings.length} items
            </Badge>
          </CardHeader>

          <CardBody className="space-y-4">
            {alerts.stuckBookings.length > 0 && (
              <div>
                <div className="text-sm font-semibold text-slate-200">
                  Bookings needing attention
                </div>

                <div className="mt-2 divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/30">
                  {alerts.stuckBookings.map((b) => (
                    <div
                      key={b.id}
                      className="flex flex-wrap items-center justify-between gap-2 p-3"
                    >
                      <div className="text-sm text-slate-200">
                        <span className="font-mono text-xs">{b.id}</span>
                        <span className="text-slate-500"> · </span>
                        <span>{b.lockerId}</span>
                      </div>

                      <StatusPill status={b.status} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {alerts.badLockers.length > 0 && (
              <div>
                <div className="text-sm font-semibold text-slate-200">
                  Lockers not available
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  {alerts.badLockers.map((l) => (
                    <Badge key={l.id} color="red">
                      {l.name ?? l.id}: {l.status}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Recent events</h2>
            <div className="text-xs text-slate-400">Latest {logs.length} logs</div>
          </div>

          <Link to="/admin/logs">
            <Button variant="secondary" size="sm">
              Open logs
            </Button>
          </Link>
        </CardHeader>

        <CardBody>
          <div className="divide-y divide-slate-800">
            {logs.map((l) => (
              <div key={l.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-200">
                    {l.type}
                  </div>
                  <div className="text-xs text-slate-500">{fmtTs(l.createdAt)}</div>
                </div>

                <div className="mt-1 text-sm text-slate-300">{l.message}</div>

                <div className="mt-1 text-xs text-slate-500">
                  Locker: {l.lockerId ?? "—"} · Booking: {l.bookingId ?? "—"} · User:{" "}
                  {l.userId ?? "—"}
                </div>
              </div>
            ))}

            {logs.length === 0 && (
              <div className="py-6 text-sm text-slate-400">No logs yet.</div>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
