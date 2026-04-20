import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
  limit,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import QRCode from "react-qr-code";
import { db } from "../../lib/firebase";
import { useAuth } from "../../lib/auth";
import type { Booking, Locker } from "../../lib/types";
import { Button, Card, CardBody, CardHeader, Badge } from "../../components/ui";
import Countdown from "../../components/Countdown";
import StatusPill from "../../components/StatusPill";

function toMs(ts: any): number | null {
  if (!ts) return null;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  return null;
}

const DEFAULT_PAYMENT_AMOUNT_PHP = 25;;

function stepIndexFor(status?: string | null) {
  if (status === "reserved") return 0;
  if (status === "pending_payment") return 1;
  if (status === "active") return 2;
  if (status === "completed" || status === "cancelled" || status === "expired" || status === "failed") return 3;
  return 0;
}

export default function MyBookingPage() {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const navigate = useNavigate();

  const [booking, setBooking] = useState<Booking | null>(null);
  const [locker, setLocker] = useState<Locker | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, "bookings"),
      where("userId", "==", uid),
      orderBy("createdAt", "desc"),
      limit(1)
    );

    return onSnapshot(
      q,
      (snap) => {
        const d = snap.docs[0]?.data() as any;
        setBooking(d ? ({ id: snap.docs[0].id, ...d } as Booking) : null);
      },
      (e) => setErr(e.message)
    );
  }, [uid]);

  useEffect(() => {
    if (!booking?.lockerId) {
      setLocker(null);
      return;
    }

    const ref = doc(db, "lockers", booking.lockerId);
    return onSnapshot(ref, (snap) => {
      setLocker(snap.exists() ? ({ id: snap.id, ...snap.data() } as any) : null);
    });
  }, [booking?.lockerId]);

  // AUTO REDIRECT TO CONTROL PANEL AFTER ADMIN CONFIRMS PAYMENT
  useEffect(() => {
    if (!booking?.id) return;

    const paymentConfirmed =
      (booking as any)?.paymentConfirmed === true ||
      (booking as any)?.paymentStatus === "paid";

    const userControlEnabled =
      (booking as any)?.userControlEnabled === true;

    // strict mode: admin must explicitly allow user control
    if (booking.status === "active" && paymentConfirmed && userControlEnabled) {
      navigate(`/app/control/${booking.id}`);
    }

    // demo fallback:
    // if you want auto-redirect as soon as booking becomes active,
    // even if userControlEnabled is not yet written:
    // if (booking.status === "active" && paymentConfirmed) {
    //   navigate(`/app/control/${booking.id}`);
    // }
  }, [booking, navigate]);

  const holdMs = useMemo(() => toMs((booking as any)?.holdExpiresAt), [booking]);

  const retrievalQrPayload = useMemo(() => {
    const b = booking;
    if (!b || b.status !== "active") return null;

    const claimToken = (b as any)?.claimQrToken ?? b.id;
    return JSON.stringify({
      v: 1,
      type: "claim",
      bookingId: b.id,
      lockerId: b.lockerId,
      token: claimToken,
    });
  }, [booking]);

  async function cancel() {
    if (!booking?.id || !booking?.lockerId) return;

    try {
      const bookingRef = doc(db, "bookings", booking.id);
      const lockerRef = doc(db, "lockers", booking.lockerId);

      const batch = writeBatch(db);

      batch.update(bookingRef, {
        status: "cancelled",
      } as any);

      batch.update(lockerRef, {
        status: "available",
        pendingPayment: false,
        occupied: false,
        currentBookingId: null,
        pendingPaymentExpiresAt: null,
        updatedAt: serverTimestamp(),
      } as any);

      await batch.commit();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    }
  }

  async function copyText(v: string) {
    try {
      await navigator.clipboard.writeText(v);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    } finally {
      setTimeout(() => setCopyState("idle"), 1500);
    }
  }

  if (!booking) {
    return (
      <Card>
        <CardHeader>
          <div className="text-lg font-bold">My booking</div>
          <div className="text-sm text-slate-400">No recent booking found.</div>
        </CardHeader>
        <CardBody>
          <div className="text-sm text-slate-400">Reserve a locker to start.</div>
          <div className="mt-3">
            <Button className="w-full" onClick={() => navigate("/app/lockers")}>
              Go to Lockers
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  const isTerminal =
    booking.status === "completed" ||
    booking.status === "cancelled" ||
    booking.status === "expired" ||
    booking.status === "failed";

  const canCancel = booking.status === "reserved" || booking.status === "pending_payment";
  const stepIdx = stepIndexFor(booking.status);
  const amount = typeof (booking as any)?.amount === "number" ? (booking as any).amount : DEFAULT_PAYMENT_AMOUNT_PHP;
  const refCode = booking?.id ? booking.id.slice(0, 10) : "";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-lg font-bold">My booking</div>
              <div className="text-sm text-slate-400">
                Reserve → Insert Coins → Use Locker → Retrieve with QR
              </div>
            </div>
            <StatusPill status={booking.status} />
          </div>

          <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/30 p-3">
            <div className="flex items-center">
              {[
                { title: "Reserve", desc: "Locker selected" },
                { title: "Insert Coins", desc: "₱25 required" },
                { title: "In Use", desc: "Locker secured" },
                { title: "Retrieve", desc: "Scan personal QR" },
              ].map((s, i) => {
                const done = i < stepIdx;
                const current = i === stepIdx;

                return (
                  <React.Fragment key={s.title}>
                    <div className="min-w-0 flex flex-col items-center text-center">
                      <div
                        className={
                          "flex h-8 w-8 items-center justify-center rounded-full border text-sm font-bold " +
                          (done
                            ? "border-emerald-400/30 bg-emerald-500/20 text-emerald-200"
                            : current
                            ? "border-cyan-400/30 bg-cyan-500/20 text-cyan-200"
                            : "border-slate-700/60 bg-slate-800/60 text-slate-300")
                        }
                      >
                        {done ? "✓" : i + 1}
                      </div>
                      <div className="mt-1 text-xs font-semibold text-slate-200">{s.title}</div>
                      <div className="whitespace-nowrap text-[11px] text-slate-500">{s.desc}</div>
                    </div>

                    {i < 3 && (
                      <div
                        className={
                          "mx-2 h-1 flex-1 rounded " +
                          (i < stepIdx
                            ? "bg-emerald-500/30"
                            : i === stepIdx
                            ? "bg-cyan-500/25"
                            : "bg-slate-800/60")
                        }
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </CardHeader>

        <CardBody>
          {err && <div className="mb-3 text-sm text-red-300">{err}</div>}

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="text-sm text-slate-400">Locker</div>
              <div className="font-semibold">{locker?.name ?? booking.lockerId}</div>
              <div className="text-xs text-slate-500">Location: {locker?.location ?? "—"}</div>
            </div>
            <div>
              <div className="text-sm text-slate-400">Booking ID</div>
              <div className="break-all font-mono text-xs">{booking.id}</div>
            </div>
          </div>

          {(booking.status === "reserved" || booking.status === "pending_payment") && holdMs && (
            <div className="mt-4">
              <Badge color="yellow">Payment window</Badge>
              <div className="mt-2 text-3xl font-extrabold">
                <Countdown targetMs={holdMs} />
              </div>
              <div className="mt-1 text-sm text-slate-400">
                Insert coins within the time window to activate your locker session.
              </div>
            </div>
          )}

          {booking.status === "pending_payment" && (
            <div className="mt-6 space-y-3 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
              <div>
                <div className="font-semibold">Cash payment only</div>
                <div className="text-sm text-slate-400">
                  This locker accepts payment through the coin slot connected to the ESP32.
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge color="amber">Amount due: ₱{amount}</Badge>
                <Badge color="blue">Insert five 5-peso coins</Badge>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 text-sm">
                <div className="font-semibold">Instructions</div>
                <div className="mt-1 text-slate-300">
                  Insert coins into the locker coin slot. Once the total reaches <b>₱25</b>, the ESP32
                  will notify the backend and the locker will unlock automatically.
                </div>

                <div className="mt-3 text-xs text-slate-400">Reference code</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <div className="rounded-lg border border-slate-700 bg-slate-950/40 px-2 py-1 font-mono text-xs">
                    {refCode}
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => copyText(refCode)}>
                    {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy"}
                  </Button>
                </div>
              </div>

              <div className="text-sm text-slate-300">
                Waiting for <b>ESP32 payment confirmation</b>.
              </div>
            </div>
          )}

          {booking.status === "active" && (
              <div className="mt-6 space-y-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                <div>
                  <div className="font-semibold">Locker in use</div>
                  <div className="text-sm text-slate-400">
                    Your payment has been confirmed and the locker is assigned to you.
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 text-sm">
                  <div className="font-semibold">Next step</div>
                  <div className="mt-1 text-slate-300">
                    Continue to the locker control page to choose your cleaning mode:
                    <b> Recommended Preset</b>, <b>Disinfect</b>, <b>Fan</b>, or <b>UV-C</b>.
                  </div>

                  <div className="mt-3">
                    <Button onClick={() => navigate(`/app/control/${booking.id}`)}>
                      Next
                    </Button>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 text-sm">
                  <div className="font-semibold">Important</div>
                  <div className="mt-1 text-slate-300">
                    Keep your personal retrieval QR. You will use it later to reopen your locker.
                  </div>
                </div>

                {retrievalQrPayload && (
                  <div className="grid items-start gap-4 md:grid-cols-2">
                    <div className="inline-flex justify-center rounded-2xl bg-white p-4 text-slate-950">
                      <QRCode value={retrievalQrPayload} size={180} />
                    </div>

                    <div>
                      <div className="font-semibold">Personal retrieval QR</div>
                      <div className="text-sm text-slate-400">
                        Present this QR when you return. The ESP32-CAM will scan it, and the backend
                        will verify that it belongs to your active booking and locker.
                      </div>

                      <div className="mt-2 break-all text-xs text-slate-500">{retrievalQrPayload}</div>

                      <div className="mt-3 flex flex-col gap-2 md:flex-row">
                        <Button onClick={() => navigate(`/app/control/${booking.id}`)}>
                          Next
                        </Button>

                        <Button variant="secondary" size="sm" onClick={() => copyText(retrievalQrPayload)}>
                          {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy payload"}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

          {isTerminal && (
            <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-semibold">Booking finished</div>
                  <div className="text-sm text-slate-400">
                    Status: <span className="font-semibold text-slate-200">{booking.status}</span>
                  </div>
                </div>

                <Badge color={booking.status === "completed" ? "green" : "red"}>{booking.status}</Badge>
              </div>

              <div className="mt-4 flex flex-col gap-2 md:flex-row">
                <Button onClick={() => navigate("/app/lockers")}>Reserve another locker</Button>
                <Button variant="secondary" onClick={() => navigate("/app/history")}>
                  View history
                </Button>
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-col gap-2 md:flex-row">
            {canCancel && (
              <Button variant="danger" onClick={cancel}>
                Cancel booking
              </Button>
            )}
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Refresh
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}