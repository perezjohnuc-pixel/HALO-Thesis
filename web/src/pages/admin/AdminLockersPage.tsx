import React, { useEffect, useState } from "react";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import { Button, Card, CardBody, CardHeader, Input, Label } from "../../components/ui";
import StatusPill from "../../components/StatusPill";
import { fmtTs } from "../../lib/format";
import type { Locker, LockerStatus, LogEvent } from "../../lib/types";

type Row = { id: string; data: Locker };

const col = collection(db, "lockers");

function withId<T>(docSnap: any): T & { id: string } {
  return { id: docSnap.id, ...(docSnap.data?.() ?? {}) };
}

function LockerTimeline({ lockerId }: { lockerId: string }) {
  const [logs, setLogs] = useState<Array<LogEvent & { id: string }>>([]);

  useEffect(() => {
    const q = query(
      collection(db, "logs"),
      where("lockerId", "==", lockerId),
      orderBy("createdAt", "desc"),
      limit(6)
    );
    return onSnapshot(q, (snap) => setLogs(snap.docs.map((d) => withId<LogEvent>(d))));
  }, [lockerId]);

  if (logs.length === 0) return <div className="text-xs text-slate-500">No logs for this locker yet.</div>;

  return (
    <div className="mt-2 divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/30">
      {logs.map((l) => (
        <div key={l.id} className="p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-slate-200">{l.type}</div>
            <div className="text-[11px] text-slate-500">{fmtTs(l.createdAt) || "—"}</div>
          </div>
          <div className="mt-1 text-xs text-slate-300">{l.message}</div>
        </div>
      ))}
    </div>
  );
}

export default function AdminLockersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [form, setForm] = useState({ name: "", location: "" });

  useEffect(() => {
    const q = query(col, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, data: d.data() as Locker })));
    });
    return () => unsub();
  }, []);

  async function setStatus(id: string, status: LockerStatus) {
    setErr(null);
    setBusy(id);
    try {
      await updateDoc(doc(col, id), { status });
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  async function forceRelease(id: string) {
    setErr(null);
    setBusy(id);
    try {
      await updateDoc(doc(col, id), {
        status: "available",
        occupied: false,
        currentBookingId: null,
        reservedByUserId: null,
        pendingPayment: false,
        reservationExpiresAt: null,
        pendingPaymentExpiresAt: null,
      });
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  async function updateBookingForLocker(lockerId: string, bookingId: string, patch: Record<string, any>) {
    setErr(null);
    setBusy(lockerId);
    try {
      await updateDoc(doc(db, "bookings", bookingId), patch as any);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  async function createLocker(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy("new");
    try {
      const id = `locker_${Date.now()}`;
      await setDoc(doc(col, id), {
        name: form.name.trim() || `Locker ${id}`,
        location: form.location.trim() || "",
        status: "available",
        occupied: false,
        createdAt: serverTimestamp(),
      } as Partial<Locker>);
      setForm({ name: "", location: "" });
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <div className="text-lg font-semibold">Lockers</div>
          <div className="text-sm text-slate-400">
            Admin can add lockers, set offline/error for maintenance, or force-release a locker.
          </div>
        </CardHeader>
        <CardBody>
          <form onSubmit={createLocker} className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-1">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Locker 1" />
            </div>
            <div className="md:col-span-2">
              <Label>Location</Label>
              <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="UC Banilad Basement" />
            </div>
            <div className="md:col-span-1 flex items-end">
              <Button disabled={busy === "new"} className="w-full">Add locker</Button>
            </div>
          </form>

          {err ? <div className="mt-3 text-sm text-red-300">{err}</div> : null}
        </CardBody>
      </Card>

      <div className="grid gap-3">
        {rows.map((r) => (
          <Card key={r.id}>
            <CardHeader className="flex items-center justify-between">
              <div>
                <div className="font-semibold">{r.data.name}</div>
                <div className="text-xs text-slate-400">{r.data.location || "—"}</div>
              </div>
              <StatusPill status={r.data.status} />
            </CardHeader>
            <CardBody className="grid gap-3">
              <div className="grid gap-2 md:grid-cols-3 text-sm">
                <div>
                  <div className="text-slate-400">Locker ID</div>
                  <div className="font-mono break-all">{r.id}</div>
                </div>
                <div>
                  <div className="text-slate-400">Current booking</div>
                  <div className="font-mono break-all">{r.data.currentBookingId || "—"}</div>
                </div>
                <div>
                  <div className="text-slate-400">Reserved by</div>
                  <div className="font-mono break-all">{r.data.reservedByUserId || "—"}</div>
                </div>
                <div>
                  <div className="text-slate-400">Battery</div>
                  <div>{typeof r.data.batteryPct === "number" ? `${r.data.batteryPct}%` : "—"}</div>
                </div>
                <div>
                  <div className="text-slate-400">Last heartbeat</div>
                  <div>{fmtTs(r.data.lastHeartbeatAt) || "—"}</div>
                </div>
                <div>
                  <div className="text-slate-400">Last disinfection</div>
                  <div>{fmtTs(r.data.lastDisinfectionAt) || "—"}</div>
                </div>
              </div>

              {r.data.currentBookingId ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-3">
                  <div className="text-sm font-semibold text-slate-200">Current booking actions</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy === r.id}
                      onClick={() =>
                        updateBookingForLocker(r.id, r.data.currentBookingId as string, {
                          status: "completed",
                          completedAt: serverTimestamp(),
                          endAt: serverTimestamp(),
                        })
                      }
                    >
                      Mark completed
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy === r.id}
                      onClick={() =>
                        updateBookingForLocker(r.id, r.data.currentBookingId as string, {
                          status: "expired",
                          expiredAt: serverTimestamp(),
                          endAt: serverTimestamp(),
                        })
                      }
                    >
                      Expire booking
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy === r.id}
                      onClick={() =>
                        updateBookingForLocker(r.id, r.data.currentBookingId as string, {
                          status: "cancelled",
                          cancelledAt: serverTimestamp(),
                          endAt: serverTimestamp(),
                        })
                      }
                    >
                      Cancel booking
                    </Button>
                    <div className="text-xs text-slate-500 self-center">
                      These will trigger automatic locker release.
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={busy === r.id}
                  onClick={() => setStatus(r.id, "available")}
                >
                  Set available
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy === r.id}
                  onClick={() => setStatus(r.id, "offline")}
                >
                  Set offline
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy === r.id}
                  onClick={() => setStatus(r.id, "error")}
                >
                  Set error
                </Button>
                <Button
                  variant="danger"
                  disabled={busy === r.id}
                  onClick={() => forceRelease(r.id)}
                >
                  Force release
                </Button>
                <div className="text-xs text-slate-400 self-center">
                  Use <span className="text-slate-200">Admin → Devices</span> to simulate scans.
                </div>
              </div>

              <div>
                <div className="text-sm font-semibold text-slate-200">Recent logs</div>
                <LockerTimeline lockerId={r.id} />
              </div>
            </CardBody>
          </Card>
        ))}
        {rows.length === 0 ? (
          <Card>
            <CardBody className="text-sm text-slate-400">No lockers yet. Add one above.</CardBody>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
