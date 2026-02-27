import React, { useMemo, useState, useEffect } from "react";
import { Badge, Button, Card, CardBody, CardHeader, Input, Label, Select } from "../../components/ui";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  doc,
  updateDoc,
  serverTimestamp,
  addDoc,
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import type { Booking } from "../../lib/types";

function pretty(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function withId<T>(doc: any): T & { id: string } {
  return { id: doc.id, ...(doc.data?.() ?? {}) };
}

function sparkTokenFor(id: string) {
  return `spark-${id.slice(0, 8)}`;
}

export default function AdminDevicesPage() {

  const [verify, setVerify] = useState({ bookingId: "", lockerId: "", token: "", deviceId: "SIM-DEVICE-01" });
  const [pay, setPay] = useState({ lockerId: "", provider: "gcash" as "gcash" | "maya" | "cash" | "unknown", paymentPayload: "" });
  const [complete, setComplete] = useState({ lockerId: "", success: true, deviceId: "SIM-DEVICE-01" });

  const [bookings, setBookings] = useState<Array<Booking & { id: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const ok = useMemo(() => (last && last.ok ? true : false), [last]);

  useEffect(() => {
    const q = query(
      collection(db, "bookings"),
      where("status", "in", ["reserved", "pending_payment", "active"]),
      orderBy("createdAt", "desc"),
      limit(20)
    );
    return onSnapshot(q, (snap) => setBookings(snap.docs.map((d) => withId<Booking>(d))));
  }, []);

  const latestReserved = useMemo(() => bookings.find((b) => b.status === "reserved") ?? null, [bookings]);
  const latestPendingPayment = useMemo(() => bookings.find((b) => b.status === "pending_payment") ?? null, [bookings]);
  const latestActive = useMemo(() => bookings.find((b) => b.status === "active") ?? null, [bookings]);

  async function run<T>(fn: () => Promise<T>) {
    setError(null);
    setBusy(true);
    try {
      const res = await fn();
      setLast(res);
    } catch (e: any) {
      setLast(null);
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  function fillFromBooking(b: Booking & { id: string }) {
    const token = b.id;
    setVerify((curr) => ({ ...curr, bookingId: b.id, lockerId: b.lockerId, token }));
    // For online payment simulation, we reuse the token as the "raw QR payload".
    // For cash, you can change provider to "cash" and keep payload as-is.
    setPay((curr) => ({ ...curr, lockerId: b.lockerId, paymentPayload: token, provider: (curr.provider ?? "gcash") as any }));
    setComplete((curr) => ({ ...curr, lockerId: b.lockerId }));
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">Admin Operations Console</div>
            <div className="text-sm text-slate-400">
              Simple flow for admin: load booking, verify QR, confirm payment, then complete and release locker.
            </div>
          </div>
          <Badge color="blue">Simple mode</Badge>
        </CardHeader>
        <CardBody className="grid gap-4">
          <Card>
            <CardHeader>
              <div className="font-semibold">Quick fill from latest bookings</div>
              <div className="text-xs text-slate-400">Use these buttons to avoid manual copy/paste.</div>
            </CardHeader>
            <CardBody className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={!latestReserved}
                onClick={() => latestReserved && fillFromBooking(latestReserved)}
              >
                Load latest RESERVED
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!latestPendingPayment}
                onClick={() => latestPendingPayment && fillFromBooking(latestPendingPayment)}
              >
                Load latest PENDING_PAYMENT
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!latestActive}
                onClick={() => latestActive && fillFromBooking(latestActive)}
              >
                Load latest ACTIVE
              </Button>
              <div className="text-xs text-slate-400 self-center">Active tracked bookings: {bookings.length}</div>
            </CardBody>
          </Card>

          <div className="grid gap-4 md:grid-cols-3">
            <Card className="md:col-span-1">
              <CardHeader>
                <div className="font-semibold">1) Verify booking QR</div>
                <div className="text-xs text-slate-400">POST /api/verify</div>
              </CardHeader>
              <CardBody className="space-y-2">
                <div>
                  <Label>Booking ID</Label>
                  <Input value={verify.bookingId} onChange={(e) => setVerify({ ...verify, bookingId: e.target.value })} />
                </div>
                <div>
                  <Label>Locker ID</Label>
                  <Input value={verify.lockerId} onChange={(e) => setVerify({ ...verify, lockerId: e.target.value })} />
                </div>
                <div>
                  <Label>QR Token</Label>
                  <Input value={verify.token} onChange={(e) => setVerify({ ...verify, token: e.target.value })} />
                </div>
                <div>
                  <Label>Device ID</Label>
                  <Input value={verify.deviceId} onChange={(e) => setVerify({ ...verify, deviceId: e.target.value })} />
                </div>
                <Button
                  disabled={busy}

            onClick={() =>
            run(async () => {
              const bookingId = verify.bookingId?.trim();
              if (!bookingId) throw new Error("Missing Booking ID");

              // 1) Move booking forward
              await updateDoc(doc(db, "bookings", bookingId), {
                status: "pending_payment",
                verifiedAt: serverTimestamp(),
                lastUpdatedAt: serverTimestamp(),
                deviceId: verify.deviceId,
              });

            await addDoc(collection(db, "logs"), {
              type: "DEVICE_COMMAND",
              action: "UNLOCK",
              bookingId,
              lockerId: verify.lockerId,
              deviceId: verify.deviceId,
              createdAt: serverTimestamp(),
              message: "Simulated unlock via admin console (Spark-only).",
            });

            return { ok: true, message: "Verified. Locker unlock simulated. Status -> pending_payment." };
          })
        }
                >
                  Verify & Unlock
                </Button>
              </CardBody>
            </Card>

            <Card className="md:col-span-1">
              <CardHeader>
                <div className="font-semibold">2) Confirm payment</div>
                <div className="text-xs text-slate-400">POST /api/confirmPayment</div>
              </CardHeader>
              <CardBody className="space-y-2">
                <div>
                  <Label>Locker ID</Label>
                  <Input value={pay.lockerId} onChange={(e) => setPay({ ...pay, lockerId: e.target.value })} />
                </div>
                <div>
                  <Label>Provider</Label>
                  <Select value={pay.provider} onChange={(e) => setPay({ ...pay, provider: (e.target.value as any) ?? "unknown" })}>
                    <option value="gcash">gcash</option>
                    <option value="maya">maya</option>
                    <option value="cash">cash</option>
                    <option value="unknown">unknown</option>
                  </Select>
                </div>
                <div>
                  <Label>Payment Payload</Label>
                  <Input
                    value={pay.paymentPayload}
                    onChange={(e) => setPay({ ...pay, paymentPayload: e.target.value })}
                    placeholder={pay.provider === "cash" ? "e.g. CASH-REF-123" : "raw QR payload"}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setPay((p) => ({ ...p, provider: "cash", paymentPayload: p.paymentPayload || `CASH-${Date.now()}` }))}
                  >
                    Use cash
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setPay((p) => ({ ...p, provider: "gcash" }))}
                  >
                    Use online (GCash)
                  </Button>
                </div>
                <Button
                  disabled={busy}
                  onClick={() =>
                  run(async () => {
                    const bookingId = verify.bookingId?.trim();
                    if (!bookingId) throw new Error("Missing Booking ID (load a booking first)");

                    await updateDoc(doc(db, "bookings", bookingId), {
                      status: "active",
                      paymentStatus: "paid",
                      paymentProvider: pay.provider,
                      paymentPayload: pay.paymentPayload,
                      paidAt: serverTimestamp(),
                      lastUpdatedAt: serverTimestamp(),
                    });

                    await addDoc(collection(db, "logs"), {
                      type: "PAYMENT",
                      action: "CONFIRMED",
                      bookingId,
                      lockerId: pay.lockerId,
                      provider: pay.provider,
                      createdAt: serverTimestamp(),
                      message: "Simulated payment confirmation (Spark-only).",
                    });

                    return { ok: true, message: "Payment confirmed. Status -> active." };
                  })
                }
                >
                  Confirm payment
                </Button>
              </CardBody>
            </Card>

            <Card className="md:col-span-1">
              <CardHeader>
                <div className="font-semibold">3) Complete & release</div>
                <div className="text-xs text-slate-400">POST /api/complete</div>
              </CardHeader>
              <CardBody className="space-y-2">
                <div>
                  <Label>Locker ID</Label>
                  <Input value={complete.lockerId} onChange={(e) => setComplete({ ...complete, lockerId: e.target.value })} />
                </div>
                <div>
                  <Label>Device ID</Label>
                  <Input value={complete.deviceId} onChange={(e) => setComplete({ ...complete, deviceId: e.target.value })} />
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <input
                    id="ok"
                    name="ok"
                    type="checkbox"
                    aria-label="Process success"
                    checked={complete.success}
                    onChange={(e) => setComplete({ ...complete, success: e.target.checked })}
                  />
                  <Label htmlFor="ok">Process success</Label>
                </div>
                <Button
                  disabled={busy}
                  onClick={() =>
                  run(async () => {
                    const bookingId = verify.bookingId?.trim();
                    if (!bookingId) throw new Error("Missing Booking ID (load a booking first)");

                    await updateDoc(doc(db, "bookings", bookingId), {
                      status: complete.success ? "completed" : "cancelled",
                      completedAt: complete.success ? serverTimestamp() : null,
                      cancelledAt: complete.success ? null : serverTimestamp(),
                      archived: true,
                      lastUpdatedAt: serverTimestamp(),
                    });

                    await addDoc(collection(db, "logs"), {
                      type: "BOOKING",
                      action: complete.success ? "COMPLETED" : "FAILED",
                      bookingId,
                      lockerId: complete.lockerId,
                      deviceId: complete.deviceId,
                      createdAt: serverTimestamp(),
                      message: complete.success
                        ? "Simulated completion + release (Spark-only)."
                        : "Simulated failure/cancel (Spark-only).",
                    });

                    return { ok: true, message: complete.success ? "Completed. Status -> completed." : "Cancelled." };
                  })
                }
                >
                  Complete booking
                </Button>
              </CardBody>
            </Card>
          </div>

          {error ? <div className="text-sm text-red-300">{error}</div> : null}

          <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Last response</div>
              <Badge color={ok ? "green" : "slate"}>{ok ? "ok" : "—"}</Badge>
            </div>
            <pre className="mt-2 max-h-72 overflow-auto text-xs text-slate-200">{pretty(last)}</pre>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="font-semibold">Maintenance (Spark / Emulator demos)</div>
          <div className="text-sm text-slate-400">Manual trigger to expire overdue bookings and release lockers</div>
        </CardHeader>
        <CardBody className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setLast({ ok: true, message: "Expiry requires Functions. Spark-only demo: do it manually in Firestore." })}
          >
            Run expiry now
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
