import React, { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardBody, CardHeader, Input, Label } from "../../components/ui";
import {
  deviceComplete,
  deviceConfirmPayment,
  deviceVerifyQr,
  expireNow,
  getDeviceKey,
  setDeviceKey,
} from "../../lib/api";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import type { Booking } from "../../lib/types";

function withId<T>(doc: any): T & { id: string } {
  return { id: doc.id, ...(doc.data?.() ?? {}) };
}

function sparkTokenFor(id: string) {
  return `spark-${id.slice(0, 8)}`;
}

export default function AdminDevicesPage() {
  const [deviceKey, setKey] = useState(getDeviceKey());
  const [bookings, setBookings] = useState<Array<Booking & { id: string }>>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, "bookings"),
      where("status", "in", ["reserved", "pending_payment", "active"]),
      orderBy("createdAt", "desc"),
      limit(20)
    );
    return onSnapshot(q, (snap) => setBookings(snap.docs.map((d) => withId<Booking>(d))));
  }, []);

  const grouped = useMemo(() => {
    return {
      reserved: bookings.filter((b) => b.status === "reserved"),
      pendingPayment: bookings.filter((b) => b.status === "pending_payment"),
      active: bookings.filter((b) => b.status === "active"),
    };
  }, [bookings]);

  async function run(bookingId: string, action: () => Promise<any>, success: string) {
    setError(null);
    setMsg(null);
    setBusyId(bookingId);
    try {
      await action();
      setMsg(success);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusyId(null);
    }
  }

  function bookingToken(b: Booking & { id: string }) {
    return b.qrToken || sparkTokenFor(b.id);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Admin Operations</div>
            <div className="text-sm text-slate-400">No simulator guessing — just click the next step for each booking.</div>
          </div>
          <Badge color="blue">Simple flow</Badge>
        </CardHeader>
        <CardBody className="space-y-3">
          <div>
            <Label>Device API Key</Label>
            <div className="flex gap-2">
              <Input
                value={deviceKey}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Set this to the same value in functions/.env"
              />
              <Button
                variant="secondary"
                onClick={() => {
                  setDeviceKey(deviceKey);
                  setMsg("Device key saved.");
                }}
              >
                Save
              </Button>
            </div>
          </div>

          <div className="text-xs text-slate-400">
            Booking lifecycle: <span className="text-slate-200">Reserved → Pending payment → Active → Completed</span>
          </div>
          {error ? <div className="text-sm text-red-300">{error}</div> : null}
          {msg ? <div className="text-sm text-emerald-300">{msg}</div> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="font-semibold">1) Reserved bookings (verify QR)</div>
          <div className="text-sm text-slate-400">Click Verify & Unlock for the booking the user just reserved.</div>
        </CardHeader>
        <CardBody className="space-y-2">
          {grouped.reserved.map((b) => (
            <div key={b.id} className="rounded-xl border border-slate-800 p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                <div className="font-semibold">{b.id}</div>
                <div className="text-slate-400">Locker: {b.lockerId}</div>
              </div>
              <Button
                size="sm"
                disabled={busyId === b.id}
                onClick={() =>
                  run(
                    b.id,
                    () =>
                      deviceVerifyQr({
                        bookingId: b.id,
                        lockerId: b.lockerId,
                        token: bookingToken(b),
                        deviceId: "ADMIN-CONSOLE",
                      }),
                    `Booking ${b.id} moved to pending payment.`
                  )
                }
              >
                Verify & Unlock
              </Button>
            </div>
          ))}
          {grouped.reserved.length === 0 ? <div className="text-sm text-slate-400">No reserved bookings.</div> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="font-semibold">2) Pending payment (confirm payment)</div>
          <div className="text-sm text-slate-400">Click Confirm Payment after user pays ₱25.</div>
        </CardHeader>
        <CardBody className="space-y-2">
          {grouped.pendingPayment.map((b) => (
            <div key={b.id} className="rounded-xl border border-slate-800 p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                <div className="font-semibold">{b.id}</div>
                <div className="text-slate-400">Locker: {b.lockerId}</div>
              </div>
              <Button
                size="sm"
                disabled={busyId === b.id}
                onClick={() =>
                  run(
                    b.id,
                    () =>
                      deviceConfirmPayment({
                        lockerId: b.lockerId,
                        provider: "gcash",
                        paymentPayload: bookingToken(b),
                        deviceId: "ADMIN-CONSOLE",
                      }),
                    `Booking ${b.id} moved to active.`
                  )
                }
              >
                Confirm payment
              </Button>
            </div>
          ))}
          {grouped.pendingPayment.length === 0 ? <div className="text-sm text-slate-400">No pending-payment bookings.</div> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="font-semibold">3) Active bookings (complete & release)</div>
          <div className="text-sm text-slate-400">Click Complete & Release once user finishes sanitization and unlock.</div>
        </CardHeader>
        <CardBody className="space-y-2">
          {grouped.active.map((b) => (
            <div key={b.id} className="rounded-xl border border-slate-800 p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                <div className="font-semibold">{b.id}</div>
                <div className="text-slate-400">Locker: {b.lockerId}</div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={busyId === b.id}
                onClick={() =>
                  run(
                    b.id,
                    () =>
                      deviceComplete({
                        lockerId: b.lockerId,
                        deviceId: "ADMIN-CONSOLE",
                        success: true,
                      }),
                    `Booking ${b.id} completed and locker released.`
                  )
                }
              >
                Complete & Release
              </Button>
            </div>
          ))}
          {grouped.active.length === 0 ? <div className="text-sm text-slate-400">No active bookings.</div> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="font-semibold">Maintenance</div>
          <div className="text-sm text-slate-400">Use if timers are overdue and lockers are stuck.</div>
        </CardHeader>
        <CardBody>
          <Button
            variant="secondary"
            onClick={async () => {
              setError(null);
              setMsg(null);
              try {
                await expireNow();
                setMsg("Expiry run complete.");
              } catch (e: any) {
                setError(e?.message ?? String(e));
              }
            }}
          >
            Run expiry now
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
