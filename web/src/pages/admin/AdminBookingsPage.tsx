import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { Card, CardBody, Button, Select, Input } from "../../components/ui";
import { db } from "../../lib/firebase";
import type { Booking, BookingStatus } from "../../lib/types";

function withId<T>(d: any): T & { id: string } {
  return { id: d.id, ...(d.data?.() ?? {}) };
}

const STATUS_ALL: BookingStatus | "all" = "all";

const STATUS_OPTIONS: Array<{ value: BookingStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "reserved", label: "Reserved" },
  { value: "pending_payment", label: "Pending payment" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "expired", label: "Expired" },
  { value: "failed", label: "Failed" },
];

function fmt(ts?: any) {
  const ms = ts?.toMillis?.();
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

export default function AdminBookingsPage() {
  const [bookings, setBookings] = useState<Array<Booking & { id: string }>>([]);
  const [status, setStatus] = useState<BookingStatus | "all">(STATUS_ALL);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const q = query(collection(db, "bookings"), orderBy("createdAt", "desc"), limit(250));
    const unsub = onSnapshot(q, (snap) => {
      setBookings(snap.docs.map((d) => withId<Booking>(d)));
    });
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return bookings
      .filter((b) => (status === "all" ? true : b.status === status))
      .filter((b) => {
        if (!s) return true;
        return (
          (b.userId ?? "").toLowerCase().includes(s) ||
          (b.lockerId ?? "").toLowerCase().includes(s) ||
          (b.id ?? "").toLowerCase().includes(s)
        );
      });
  }, [bookings, status, search]);

  async function forceCancel(bookingId: string) {
    const ref = doc(db, "bookings", bookingId);
    await updateDoc(ref, {
      status: "cancelled",
      endAt: serverTimestamp(),
      cancelledAt: serverTimestamp(),
      archived: true,
    });
  }

  async function forceComplete(bookingId: string) {
    const ref = doc(db, "bookings", bookingId);
    await updateDoc(ref, {
      status: "completed",
      completedAt: serverTimestamp(),
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardBody>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-base font-semibold">Bookings</h2>
              <div className="mt-1 text-xs text-slate-400">Latest 250 bookings (real-time)</div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Select value={status} onChange={(e) => setStatus(e.target.value as any)}>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <Input
                placeholder="Search bookingId / lockerId / userId"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-4">
        {filtered.map((b) => (
          <Card key={b.id}>
            <CardBody>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-100">
                    {b.id} <span className="text-slate-500">· {b.status}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    Locker: <span className="text-slate-200">{b.lockerId}</span> · User: <span className="text-slate-200">{b.userId}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Created: {fmt(b.createdAt)} · Hold expires: {fmt((b as any).holdExpiresAt)} · End: {fmt((b as any).endAt)}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" onClick={() => forceComplete(b.id)} disabled={b.status !== "active"}>
                    Mark Completed
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => forceCancel(b.id)}
                    disabled={!(b.status === "reserved" || b.status === "pending_payment" || b.status === "active")}
                  >
                    Force Cancel
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>
        ))}

        {filtered.length === 0 && (
          <Card>
            <CardBody>
              <div className="text-sm text-slate-400">No bookings matched your filters.</div>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
