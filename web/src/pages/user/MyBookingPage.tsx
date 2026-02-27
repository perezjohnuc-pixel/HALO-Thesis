import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  limit
} from "firebase/firestore";
import QRCode from "react-qr-code";
import { db } from "../../lib/firebase";
import { useAuth } from "../../lib/auth";
import type { Booking, Locker } from "../../lib/types";
import { Button, Card, CardBody, CardHeader, Badge } from "../../components/ui";
import Countdown from "../../components/Countdown";
import StatusPill from "../../components/StatusPill";
import { userCompleteBooking } from "../../lib/api";

function toMs(ts: any): number | null {
  if (!ts) return null;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  return null;
}

// Thesis demo fixed price (PHP)
const PAYMENT_AMOUNT_PHP = 25;
const MODE_CONFIG = [
  { id: "mist", label: "Mist Disinfection", minutes: 2 },
  { id: "dryer", label: "Dryer", minutes: 3 },
  { id: "uvc", label: "UV-C", minutes: 2 },
] as const;

export default function MyBookingPage() {
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  const [booking, setBooking] = useState<Booking | null>(null);
  const navigate = useNavigate();
  const [locker, setLocker] = useState<Locker | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [selectedModes, setSelectedModes] = useState<string[]>(["mist"]);
  const [sequenceName, setSequenceName] = useState<"custom" | "all">("custom");
  const [runningProgram, setRunningProgram] = useState(false);
  const [programDone, setProgramDone] = useState(false);
  const [busyUnlock, setBusyUnlock] = useState(false);

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

  const holdMs = useMemo(() => toMs((booking as any)?.holdExpiresAt), [booking]);
  const endMs = useMemo(() => toMs((booking as any)?.endAt), [booking]);

  const lockerQrPayload = useMemo(() => {
    if (!booking?.qrToken) return null;
    // QR scanned by the locker. Locker should verify BOTH lockerId + token.
    // This prevents other lockers from accepting the wrong user's QR.
    return JSON.stringify({
      v: 1,
      type: "unlock",
      bookingId: booking.id,
      lockerId: booking.lockerId,
      token: booking.qrToken
    });
  }, [booking]);

  const paymentQrPayload = useMemo(() => {
    if (!booking?.qrToken) return null;
    // For demo: structured payload representing an e-wallet payment request.
    // (In production, replace with a provider/merchant QR from GCash/Maya, etc.)
    const amount = typeof (booking as any).amount === "number" ? (booking as any).amount : PAYMENT_AMOUNT_PHP;
    return JSON.stringify({
      v: 1,
      type: "pay",
      bookingId: booking.id,
      lockerId: booking.lockerId,
      amount,
      currency: "PHP",
      ref: booking.qrToken
    });
  }, [booking]);

  async function cancel() {
    if (!booking?.id) return;
    try {
      const ref = doc(db, "bookings", booking.id);
      // Client only sets status. Backend will attach cancelledAt/endAt and release the locker.
      await updateDoc(ref, { status: "cancelled" } as any);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    }
  }

  async function copyQrPayload() {
    if (!displayQrPayload) return;
    try {
      await navigator.clipboard.writeText(displayQrPayload);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    } finally {
      setTimeout(() => setCopyState("idle"), 1500);
    }
  }

  function toggleMode(modeId: string) {
    setProgramDone(false);
    setSequenceName("custom");
    setSelectedModes((curr) =>
      curr.includes(modeId) ? curr.filter((id) => id !== modeId) : [...curr, modeId]
    );
  }

  async function runProgram() {
    if (selectedModes.length === 0) {
      setErr("Please choose at least one sanitation mode before running.");
      return;
    }

    setErr(null);
    setRunningProgram(true);
    setProgramDone(false);
    const totalMs = selectedModes.reduce((acc, modeId) => {
      const mode = MODE_CONFIG.find((m) => m.id === modeId);
      return acc + (mode ? mode.minutes * 1000 : 0);
    }, 0);

    window.setTimeout(() => {
      setRunningProgram(false);
      setProgramDone(true);
    }, Math.max(1200, totalMs));
  }

  async function unlockFromApp() {
    if (!booking?.id) return;
    if (!programDone) {
      setErr("Run and finish your selected sanitation mode first.");
      return;
    }
    setErr(null);
    setBusyUnlock(true);
    try {
      await userCompleteBooking({ bookingId: booking.id, selectedModes, sequenceName });
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusyUnlock(false);
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
            <Button className="w-full" onClick={() => navigate("/app/lockers")}>Go to Lockers</Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  const canCancel = booking.status === "reserved" || booking.status === "pending_payment";
  const displayQrPayload = booking.status === "pending_payment" ? paymentQrPayload : lockerQrPayload;
  const showQr = (booking.status === "reserved" || booking.status === "pending_payment") && !!displayQrPayload;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-lg font-bold">My booking</div>
              <div className="text-sm text-slate-400">Track your current reservation/session.</div>
            </div>
            <StatusPill status={booking.status} />
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
              <div className="font-mono text-xs break-all">{booking.id}</div>
            </div>
          </div>

          {(booking.status === "reserved" || booking.status === "pending_payment") && holdMs && (
            <div className="mt-4">
              <Badge color="yellow">Hold time left</Badge>
              <div className="mt-2 text-3xl font-extrabold">
                <Countdown targetMs={holdMs} />
              </div>
              <div className="text-sm text-slate-400 mt-1">
                {booking.status === "reserved"
                  ? "Scan the QR at the locker within 3 minutes."
                  : "Complete payment within 2 minutes after scanning."}
              </div>
            </div>
          )}

          {booking.status === "active" && endMs && (
            <div className="mt-4">
              <Badge color="blue">Session time left</Badge>
              <div className="mt-2 text-3xl font-extrabold">
                <Countdown targetMs={endMs} />
              </div>
              <div className="text-sm text-slate-400 mt-1">Your session will auto-complete when the timer ends.</div>
            </div>
          )}

          {booking.status === "active" && (
            <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/40 p-4 space-y-3">
              <div>
                <div className="font-semibold">Post-payment sanitation controls</div>
                <div className="text-sm text-slate-400">Choose your preferred mode, run it, then unlock from app.</div>
              </div>

              <div className="grid gap-2 md:grid-cols-3">
                {MODE_CONFIG.map((mode) => {
                  const selected = selectedModes.includes(mode.id);
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      className={`rounded-xl border px-3 py-2 text-left text-sm transition ${selected ? "border-sky-400/50 bg-sky-500/10 text-sky-200" : "border-slate-800 bg-slate-900/40 text-slate-200 hover:bg-slate-900"}`}
                      onClick={() => toggleMode(mode.id)}
                    >
                      <div className="font-semibold">{mode.label}</div>
                      <div className="text-xs text-slate-400">Recommended: {mode.minutes} min</div>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSequenceName("all");
                    setSelectedModes(MODE_CONFIG.map((m) => m.id));
                    setProgramDone(false);
                  }}
                >
                  Use all in sequence
                </Button>
                <Button variant="secondary" size="sm" onClick={runProgram} disabled={runningProgram || selectedModes.length === 0}>
                  {runningProgram ? "Running selected mode(s)…" : "Run selected mode(s)"}
                </Button>
                <Button onClick={unlockFromApp} disabled={busyUnlock || !programDone}>
                  {busyUnlock ? "Unlocking…" : "Unlock locker from app"}
                </Button>
              </div>

              <div className="text-xs text-slate-400">
                {programDone
                  ? "Sanitation complete. You can now unlock and finish this booking."
                  : "After running your selected mode(s), Unlock becomes available."}
              </div>
            </div>
          )}

          {showQr && (
            <div className="mt-6 grid gap-4 md:grid-cols-2 items-start">
              <div className="rounded-2xl bg-white p-4 text-slate-950 inline-flex justify-center">
                <QRCode value={displayQrPayload as string} size={180} />
              </div>
              <div>
                <div className="font-semibold">{booking.status === "pending_payment" ? "Payment QR" : "Locker QR"}</div>
                <div className="text-sm text-slate-400">
                  {booking.status === "pending_payment" ? (
                    <>
                      After the locker recognizes you, pay <b>₱{(booking as any)?.amount ?? PAYMENT_AMOUNT_PHP}</b> by scanning this QR in your
                      e-wallet within the payment window.
                    </>
                  ) : (
                    <>
                      Show this QR to the locker scanner. It is bound to <b>{booking.lockerId}</b> — other lockers should reject it.
                    </>
                  )}
                </div>
                <div className="mt-2 text-xs text-slate-500 break-all">{displayQrPayload}</div>
                <div className="mt-3">
                  <Button variant="secondary" size="sm" onClick={copyQrPayload}>
                    {copyState === "copied" ? "QR payload copied" : copyState === "failed" ? "Copy failed" : "Copy QR payload"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-col md:flex-row gap-2">
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
