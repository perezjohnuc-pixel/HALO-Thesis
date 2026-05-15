import React, { useEffect, useState } from "react";
import {
  addDoc,
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
  writeBatch,
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Label,
} from "../../components/ui";
import StatusPill from "../../components/StatusPill";
import { fmtTs } from "../../lib/format";
import type { Locker, LockerStatus, LogEvent } from "../../lib/types";

type Row = { id: string; data: Locker };

const lockersCol = collection(db, "lockers");

function withId<T>(docSnap: any): T & { id: string } {
  return { id: docSnap.id, ...(docSnap.data?.() ?? {}) };
}

async function addLog(input: {
  type: string;
  message: string;
  lockerId?: string | null;
  bookingId?: string | null;
  userId?: string | null;
  payload?: any;
}) {
  await addDoc(collection(db, "logs"), {
    ...input,
    createdAt: serverTimestamp(),
  });
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

    return onSnapshot(q, (snap) =>
      setLogs(snap.docs.map((d) => withId<LogEvent>(d)))
    );
  }, [lockerId]);

  if (logs.length === 0) {
    return <div className="text-xs text-slate-500">No logs for this locker yet.</div>;
  }

  return (
    <div className="mt-2 divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/30">
      {logs.map((l) => (
        <div key={l.id} className="p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-slate-200">{l.type}</div>
            <div className="text-[11px] text-slate-500">
              {fmtTs(l.createdAt) || "—"}
            </div>
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
    const q = query(lockersCol, orderBy("createdAt", "desc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        setRows(snap.docs.map((d) => ({ id: d.id, data: d.data() as Locker })));
      },
      (e) => setErr(e.message)
    );

    return () => unsub();
  }, []);

  async function setStatus(id: string, status: LockerStatus) {
    setErr(null);
    setBusy(id);

    try {
      await updateDoc(doc(lockersCol, id), {
        status,
        updatedAt: serverTimestamp(),
      } as any);

      await addLog({
        type: "LOCKER",
        lockerId: id,
        message: `Admin set locker status to ${status}.`,
      });
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  async function forceRelease(row: Row) {
    setErr(null);
    setBusy(row.id);

    try {
      const lockerRef = doc(db, "lockers", row.id);
      const batch = writeBatch(db);

      batch.update(lockerRef, {
        status: "available",
        occupied: false,
        currentBookingId: null,
        reservedByUserId: null,
        pendingPayment: false,
        reservationExpiresAt: null,
        pendingPaymentExpiresAt: null,
        updatedAt: serverTimestamp(),
      } as any);

      if (row.data.currentBookingId) {
        batch.update(doc(db, "bookings", row.data.currentBookingId), {
          status: "cancelled",
          cancelledAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          programStep: "admin_force_released",
          deviceStatus: {
            lock: true,
            mist: false,
            fan: false,
            uvc: false,
          },
        } as any);
      }

      await batch.commit();

      await addLog({
        type: "ADMIN_OVERRIDE",
        lockerId: row.id,
        bookingId: row.data.currentBookingId ?? null,
        message: "Admin force-released the locker and cleared current booking.",
      });
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

      await setDoc(doc(lockersCol, id), {
        name: form.name.trim() || `Locker ${rows.length + 1}`,
        location: form.location.trim() || "SHS-UCB",
        status: "available",
        occupied: false,
        currentBookingId: null,
        reservedByUserId: null,
        pendingPayment: false,
        reservationExpiresAt: null,
        pendingPaymentExpiresAt: null,
        lastCompletedAt: null,
        lastDisinfectionAt: null,
        lastPaymentAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } as Partial<Locker>);

      await addLog({
        type: "LOCKER",
        lockerId: id,
        message: "Admin added a new locker.",
      });

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
            Add lockers, set lockers to maintenance, and force-release stuck lockers.
          </div>
        </CardHeader>

        <CardBody>
          <form onSubmit={createLocker} className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-1">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Locker 1"
              />
            </div>

            <div className="md:col-span-2">
              <Label>Location</Label>
              <Input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="SHS-UCB"
              />
            </div>

            <div className="flex items-end md:col-span-1">
              <Button disabled={busy === "new"} className="w-full">
                {busy === "new" ? "Adding..." : "Add locker"}
              </Button>
            </div>
          </form>

          {err && <div className="mt-3 text-sm text-red-300">{err}</div>}
        </CardBody>
      </Card>

      <div className="grid gap-3">
        {rows.map((r) => (
          <Card key={r.id}>
            <CardHeader className="flex items-center justify-between">
              <div>
                <div className="font-semibold">{r.data.name ?? r.id}</div>
                <div className="text-xs text-slate-400">
                  {r.data.location || "—"}
                </div>
              </div>

              <StatusPill status={r.data.status} />
            </CardHeader>

            <CardBody className="grid gap-3">
              <div className="grid gap-2 text-sm md:grid-cols-3">
                <div>
                  <div className="text-slate-400">Locker ID</div>
                  <div className="break-all font-mono">{r.id}</div>
                </div>

                <div>
                  <div className="text-slate-400">Current booking</div>
                  <div className="break-all font-mono">
                    {r.data.currentBookingId || "—"}
                  </div>
                </div>

                <div>
                  <div className="text-slate-400">Reserved by</div>
                  <div className="break-all font-mono">
                    {r.data.reservedByUserId || "—"}
                  </div>
                </div>

                <div>
                  <div className="text-slate-400">Occupied</div>
                  <div>{r.data.occupied ? "Yes" : "No"}</div>
                </div>

                <div>
                  <div className="text-slate-400">Pending payment</div>
                  <div>{r.data.pendingPayment ? "Yes" : "No"}</div>
                </div>

                <div>
                  <div className="text-slate-400">Last disinfection</div>
                  <div>{fmtTs(r.data.lastDisinfectionAt) || "—"}</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy === r.id}
                  onClick={() => setStatus(r.id, "available")}
                >
                  Set available
                </Button>

                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy === r.id}
                  onClick={() => setStatus(r.id, "maintenance")}
                >
                  Set maintenance
                </Button>

                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy === r.id}
                  onClick={() => setStatus(r.id, "offline")}
                >
                  Set offline
                </Button>

                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy === r.id}
                  onClick={() => setStatus(r.id, "error")}
                >
                  Set error
                </Button>

                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy === r.id}
                  onClick={() => forceRelease(r)}
                >
                  Force release
                </Button>

                {r.data.status === "maintenance" && (
                  <Badge color="amber">Hidden from normal use</Badge>
                )}
              </div>

              <div>
                <div className="text-sm font-semibold text-slate-200">
                  Recent logs
                </div>
                <LockerTimeline lockerId={r.id} />
              </div>
            </CardBody>
          </Card>
        ))}

        {rows.length === 0 && (
          <Card>
            <CardBody className="text-sm text-slate-400">
              No lockers yet. Add one above.
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
