import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  limit,
} from "firebase/firestore";
import QRCode from "react-qr-code";
import { db } from "../../lib/firebase";
import { useAuth } from "../../lib/auth";
import type { Booking, Locker, PaymentMethod } from "../../lib/types";
import { Button, Card, CardBody, CardHeader, Badge } from "../../components/ui";
import Countdown from "../../components/Countdown";
import StatusPill from "../../components/StatusPill";
import api from "../../lib/api";

function toMs(ts: any): number | null {
  if (!ts) return null;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  return null;
}

// Thesis demo fixed price (PHP)
const PAYMENT_AMOUNT_PHP = 25;

// Optional: show a second payment QR immediately after reservation.
// (This is only for very fast Spark demos; for the "real" story, payment happens after scan.)
const SPARK_DEMO = String(import.meta.env.VITE_SPARK_DEMO || "").toLowerCase() === "true";

// Optional demo speedup (default is 30x faster so you can present without waiting minutes).
// Set VITE_DEMO_SPEED=1 for real timing.
const DEFAULT_DEMO_SPEED = (() => {
  const v = Number(import.meta.env.VITE_DEMO_SPEED || 30);
  return Number.isFinite(v) && v > 0 ? v : 30;
})();

const MODE_CONFIG = [
  { id: "mist", label: "Mist Disinfection", minutes: 2, hint: "Kills surface bacteria" },
  { id: "dryer", label: "Heater / Dryer", minutes: 3, hint: "Dries wet items" },
  { id: "uvc", label: "UV-C", minutes: 2, hint: "UV sterilization" },
] as const;

type ModeId = (typeof MODE_CONFIG)[number]["id"];

type ProgramPreset = "full" | "quick" | "dry" | "custom";

const PRESETS: Array<{
  id: ProgramPreset;
  title: string;
  description: string;
  modes: ModeId[] | null;
}> = [
  {
    id: "full",
    title: "Full sanitize (recommended)",
    description: "Mist → Dryer → UV‑C",
    modes: ["mist", "dryer", "uvc"],
  },
  {
    id: "quick",
    title: "Quick clean",
    description: "Mist + UV‑C",
    modes: ["mist", "uvc"],
  },
  {
    id: "dry",
    title: "Dry only",
    description: "Heater / Dryer",
    modes: ["dryer"],
  },
  {
    id: "custom",
    title: "Custom",
    description: "Choose your own combination",
    modes: null,
  },
];

function stepIndexFor(status?: string | null) {
  // 0 Scan QR -> 1 Payment -> 2 Sanitation -> 3 Done
  if (status === "reserved") return 0;
  if (status === "pending_payment") return 1;
  if (status === "active") return 2;
  if (status === "completed" || status === "cancelled" || status === "expired" || status === "failed") return 3;
  return 0;
}

function fmtTotalMinutes(modes: string[]) {
  const total = modes.reduce((acc, id) => {
    const m = MODE_CONFIG.find((x) => x.id === id);
    return acc + (m ? m.minutes : 0);
  }, 0);
  return total;
}

export default function MyBookingPage() {
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  const [booking, setBooking] = useState<Booking | null>(null);
  const navigate = useNavigate();
  const [locker, setLocker] = useState<Locker | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  // Payment method selection (stored locally; Firestore rules forbid booking updates by user)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("online");

  // Sanitation program selection
  const [preset, setPreset] = useState<ProgramPreset>("full");
  const [selectedModes, setSelectedModes] = useState<ModeId[]>(["mist", "dryer", "uvc"]);

  // Program execution state
  const [demoSpeed, setDemoSpeed] = useState<number>(DEFAULT_DEMO_SPEED);
  const [runningProgram, setRunningProgram] = useState(false);
  const [programDone, setProgramDone] = useState(false);
  const [programStepIndex, setProgramStepIndex] = useState<number>(-1);
  const [programStepEndAt, setProgramStepEndAt] = useState<number | null>(null);
  const [programSteps, setProgramSteps] = useState<Array<{ id: ModeId; label: string; minutes: number }>>([]);
  const timeoutRef = useRef<number | null>(null);

  const [busyUnlock, setBusyUnlock] = useState(false);

  // ---------------------------
  // Subscribe: user's latest booking
  // ---------------------------
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

  // Subscribe: locker doc
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

  // Load persisted payment method per booking
  useEffect(() => {
    if (!booking?.id) return;
    const key = `HALO_PAYMENT_METHOD_${booking.id}`;
    const saved = (localStorage.getItem(key) || "").toLowerCase();
    if (saved === "cash" || saved === "online") {
      setPaymentMethod(saved as PaymentMethod);
    } else {
      setPaymentMethod("online");
    }
  }, [booking?.id]);

  function choosePaymentMethod(m: PaymentMethod) {
    setPaymentMethod(m);
    if (booking?.id) localStorage.setItem(`HALO_PAYMENT_METHOD_${booking.id}`, m);
  }

  // Reset program state whenever booking changes away from ACTIVE
  useEffect(() => {
    if (!booking?.id) return;
    if (booking.status !== "active") {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      setRunningProgram(false);
      setProgramDone(false);
      setProgramStepIndex(-1);
      setProgramStepEndAt(null);
      setProgramSteps([]);
    }
  }, [booking?.id, booking?.status]);

  const holdMs = useMemo(() => toMs((booking as any)?.holdExpiresAt), [booking]);
  const endMs = useMemo(() => toMs((booking as any)?.endAt), [booking]);

  const lockerQrPayload = useMemo(() => {
  const b = booking;
  const qrToken = b?.id ?? null;
  if (!qrToken || !b) return null;

  return JSON.stringify({
    v: 1,
    type: "unlock",
    bookingId: b.id,
    lockerId: b.lockerId,
    token: qrToken,
  });
}, [booking]);

const paymentQrPayload = useMemo(() => {
  const b = booking;
  const qrToken = b?.id ?? null;
  if (!qrToken || !b) return null;

  const amount = typeof (b as any).amount === "number" ? (b as any).amount : PAYMENT_AMOUNT_PHP;
  return JSON.stringify({
    v: 1,
    type: "pay",
    bookingId: b.id,
    lockerId: b.lockerId,
    amount,
    currency: "PHP",
    ref: qrToken,
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

  function setPresetModes(nextPreset: ProgramPreset) {
    setErr(null);
    setProgramDone(false);

    setPreset(nextPreset);
    if (nextPreset !== "custom") {
      const p = PRESETS.find((x) => x.id === nextPreset);
      if (p?.modes) setSelectedModes(p.modes);
    }
  }

  function toggleMode(modeId: ModeId) {
    setErr(null);
    setProgramDone(false);
    setPreset("custom");
    setSelectedModes((curr) => (curr.includes(modeId) ? curr.filter((id) => id !== modeId) : [...curr, modeId]));
  }

  function stopProgram() {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    setRunningProgram(false);
    setProgramStepIndex(-1);
    setProgramStepEndAt(null);
  }

  function finishProgramInstantly() {
    stopProgram();
    setProgramDone(true);
    setProgramStepIndex(programSteps.length);
  }

  function startNextStep(steps: Array<{ id: ModeId; label: string; minutes: number }>, idx: number) {
    if (idx >= steps.length) {
      setRunningProgram(false);
      setProgramDone(true);
      setProgramStepIndex(steps.length);
      setProgramStepEndAt(null);
      return;
    }

    const step = steps[idx];
    setProgramStepIndex(idx);

    // Convert real minutes -> ms. Then optionally speed up for demo.
    const realMs = Math.max(1, step.minutes) * 60 * 1000;
    const scaledMs = Math.max(1200, Math.round(realMs / Math.max(1, demoSpeed)));

    const endsAt = Date.now() + scaledMs;
    setProgramStepEndAt(endsAt);

    timeoutRef.current = window.setTimeout(() => {
      startNextStep(steps, idx + 1);
    }, scaledMs);
  }

  async function runProgram() {
    if (selectedModes.length === 0) {
      setErr("Please choose at least one sanitation option.");
      return;
    }
    if (!booking?.id || booking.status !== "active") {
      setErr("You can start the sanitation program only after payment is confirmed (status: ACTIVE). ");
      return;
    }
    setErr(null);

    // Always run in the physical order: Mist -> Dryer -> UV-C
    const orderedIds = MODE_CONFIG.map((m) => m.id).filter((id) => selectedModes.includes(id));
    const steps = orderedIds
      .map((id) => {
        const mode = MODE_CONFIG.find((m) => m.id === id)!;
        return { id, label: mode.label, minutes: mode.minutes };
      })
      .filter(Boolean);

    setProgramSteps(steps);
    setProgramDone(false);
    setRunningProgram(true);

    // Also notify backend (queues deviceCommands + logs). If this fails (common on Vite dev server
    // without VITE_API_BASE), we still run the local demo timers so you can present.
    try {
      await api.userStartProgram({ bookingId: booking.id, selectedModes: orderedIds, sequenceName: preset });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setErr(
        `Could not reach /api/user/startProgram (${msg}). If you are using Vite (http://localhost:5173), set VITE_API_BASE to your Functions emulator base. The UI will still run demo timers.`
      );
    }

    // Start step chain
    startNextStep(steps, 0);
  }

  async function unlockFromApp() {
    if (!booking?.id) return;
    if (!programDone) {
      setErr("Finish the sanitation program first.");
      return;
    }
    setErr(null);
    setBusyUnlock(true);
    try {
      // Send modes in correct physical order
      const orderedModes = MODE_CONFIG.map((m) => m.id).filter((id) => selectedModes.includes(id));
      await api.userCompleteBooking({
        bookingId: booking.id,
        selectedModes: orderedModes,
        sequenceName: preset,
      });
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusyUnlock(false);
    }
  }

  // ---------------------------
  // Render: no booking yet
  // ---------------------------
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

  const showLockerQr = booking.status === "reserved" && !!lockerQrPayload;
  const showPaymentQr = booking.status === "pending_payment" && paymentMethod === "online" && !!paymentQrPayload;

  // Only show the payload that matches the current flow
  const displayQrPayload = showPaymentQr ? paymentQrPayload : showLockerQr ? lockerQrPayload : null;

  // Spark-only shortcut
  const showSparkPaymentQr = SPARK_DEMO && booking.status === "reserved" && paymentMethod === "online" && !!paymentQrPayload;

  const amount = typeof (booking as any)?.amount === "number" ? (booking as any).amount : PAYMENT_AMOUNT_PHP;

  const refCode = booking?.id ? booking.id.slice(0, 10) : "";

  const totalMin = fmtTotalMinutes(selectedModes);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-lg font-bold">My booking</div>
              <div className="text-sm text-slate-400">Scan → Pay → Sanitize → Unlock</div>
            </div>
            <StatusPill status={booking.status} />
          </div>

          {/* Stepper */}
          <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/30 p-3">
            <div className="flex items-center">
              {[
                { title: "Scan QR", desc: "3 min window" },
                { title: "Payment", desc: "2 min window" },
                { title: "Sanitation", desc: "Mist → Dryer → UV‑C" },
                { title: "Done", desc: "Complete" },
              ].map((s, i) => {
                const done = i < stepIdx;
                const current = i === stepIdx;
                return (
                  <React.Fragment key={s.title}>
                    <div className="flex flex-col items-center text-center min-w-0">
                      <div
                        className={
                          "h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold border " +
                          (done
                            ? "bg-emerald-500/20 text-emerald-200 border-emerald-400/30"
                            : current
                              ? "bg-cyan-500/20 text-cyan-200 border-cyan-400/30"
                              : "bg-slate-800/60 text-slate-300 border-slate-700/60")
                        }
                      >
                        {done ? "✓" : i + 1}
                      </div>
                      <div className="mt-1 text-xs font-semibold text-slate-200">{s.title}</div>
                      <div className="text-[11px] text-slate-500 whitespace-nowrap">{s.desc}</div>
                    </div>
                    {i < 3 && (
                      <div
                        className={
                          "h-1 flex-1 mx-2 rounded " +
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
              <div className="font-mono text-xs break-all">{booking.id}</div>
            </div>
          </div>

          {/* Fair-use countdown */}
          {(booking.status === "reserved" || booking.status === "pending_payment") && holdMs && (
            <div className="mt-4">
              <Badge color="yellow">Time left</Badge>
              <div className="mt-2 text-3xl font-extrabold">
                <Countdown targetMs={holdMs} />
              </div>
              <div className="text-sm text-slate-400 mt-1">
                {booking.status === "reserved"
                  ? "Scan the QR at the locker within 3 minutes."
                  : "Choose a payment method and complete payment within 2 minutes."}
              </div>
            </div>
          )}

          {/* Active session countdown */}
          {booking.status === "active" && endMs && (
            <div className="mt-4">
              <Badge color="blue">Session time left</Badge>
              <div className="mt-2 text-3xl font-extrabold">
                <Countdown targetMs={endMs} />
              </div>
              <div className="text-sm text-slate-400 mt-1">
                Your session will auto-complete when the timer ends (or admin/device completes it).
              </div>
            </div>
          )}

          {/* Payment method choice */}
          {booking.status === "pending_payment" && (
            <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/40 p-4 space-y-3">
              <div>
                <div className="font-semibold">Payment</div>
                <div className="text-sm text-slate-400">
                  Choose how you will pay. For the thesis demo, admin/device confirms payment after you select.
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={paymentMethod === "online" ? "primary" : "secondary"}
                  onClick={() => choosePaymentMethod("online")}
                >
                  Online (GCash / Maya)
                </Button>
                <Button
                  size="sm"
                  variant={paymentMethod === "cash" ? "primary" : "secondary"}
                  onClick={() => choosePaymentMethod("cash")}
                >
                  Cash
                </Button>
                <Badge color="amber">Amount: ₱{amount}</Badge>
              </div>

              {paymentMethod === "cash" ? (
                <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 text-sm">
                  <div className="font-semibold">Cash payment instructions</div>
                  <div className="mt-1 text-slate-300">
                    Pay the amount in cash on the kiosk/attendant. Then the locker will be unlocked after payment is confirmed.
                  </div>
                  <div className="mt-2 text-xs text-slate-400">Reference code</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <div className="font-mono text-xs rounded-lg border border-slate-700 bg-slate-950/40 px-2 py-1">{refCode}</div>
                    <Button size="sm" variant="secondary" onClick={() => copyText(refCode)}>
                      {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-slate-300">
                  Scan the QR below using your e-wallet app (demo QR). Payment must be confirmed within the time window.
                </div>
              )}
            </div>
          )}

          {/* Sanitation controls (after payment) */}
          {booking.status === "active" && (
            <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/40 p-4 space-y-4">
              <div>
                <div className="font-semibold">Sanitation & drying</div>
                <div className="text-sm text-slate-400">
                  Choose a preset (recommended) or customize. The locker runs steps in this order: <b>Mist → Dryer → UV‑C</b>.
                </div>
              </div>

              {/* Presets */}
              <div className="grid gap-2 md:grid-cols-2">
                {PRESETS.map((p) => {
                  const selected = preset === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={
                        "rounded-xl border px-3 py-3 text-left text-sm transition " +
                        (selected
                          ? "border-cyan-400/50 bg-cyan-500/10 text-cyan-200"
                          : "border-slate-800 bg-slate-900/40 text-slate-200 hover:bg-slate-900")
                      }
                      onClick={() => setPresetModes(p.id)}
                    >
                      <div className="font-semibold">{p.title}</div>
                      <div className="text-xs text-slate-400">{p.description}</div>
                    </button>
                  );
                })}
              </div>

              {/* Custom mode toggles */}
              {preset === "custom" && (
                <div className="grid gap-2 md:grid-cols-3">
                  {MODE_CONFIG.map((mode) => {
                    const selected = selectedModes.includes(mode.id);
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        className={
                          "rounded-xl border px-3 py-2 text-left text-sm transition " +
                          (selected
                            ? "border-sky-400/50 bg-sky-500/10 text-sky-200"
                            : "border-slate-800 bg-slate-900/40 text-slate-200 hover:bg-slate-900")
                        }
                        onClick={() => toggleMode(mode.id)}
                      >
                        <div className="font-semibold">{mode.label}</div>
                        <div className="text-xs text-slate-400">
                          Recommended: {mode.minutes} min · {mode.hint}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Badge color="slate">Total recommended: {totalMin} min</Badge>
                <Badge color={demoSpeed === 1 ? "slate" : "blue"}>
                  Demo speed: {demoSpeed === 1 ? "real" : `x${demoSpeed}`}
                </Badge>
                <Button
                  size="sm"
                  variant={demoSpeed === 1 ? "primary" : "secondary"}
                  onClick={() => setDemoSpeed(1)}
                  disabled={runningProgram}
                >
                  Real timing
                </Button>
                <Button
                  size="sm"
                  variant={demoSpeed !== 1 ? "primary" : "secondary"}
                  onClick={() => setDemoSpeed(DEFAULT_DEMO_SPEED)}
                  disabled={runningProgram}
                >
                  Fast demo
                </Button>
              </div>

              {/* Run status */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold">Program</div>
                  <div className="text-xs text-slate-400">
                    Runs in order: Mist → Dryer → UV‑C (skips unselected steps)
                  </div>
                </div>

                {runningProgram && programSteps.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    <div className="text-sm text-slate-200">
                      Running step <b>{programStepIndex + 1}</b> of <b>{programSteps.length}</b>: {programSteps[programStepIndex]?.label}
                    </div>
                    {programStepEndAt ? (
                      <div className="text-2xl font-extrabold">
                        <Countdown targetMs={programStepEndAt} />
                      </div>
                    ) : null}

                    <div className="divide-y divide-slate-800">
                      {programSteps.map((s, i) => {
                        const state = i < programStepIndex ? "done" : i === programStepIndex ? "running" : "queued";
                        return (
                          <div key={s.id} className="py-2 flex items-center justify-between gap-2">
                            <div className="text-sm text-slate-200">
                              <span className="font-semibold">{s.label}</span>
                              <span className="text-xs text-slate-500"> · {s.minutes} min</span>
                            </div>
                            <Badge
                              color={state === "done" ? "green" : state === "running" ? "blue" : "slate"}
                            >
                              {state}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={stopProgram}>
                        Stop
                      </Button>
                      <Button size="sm" variant="secondary" onClick={finishProgramInstantly}>
                        Skip (demo)
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-slate-300">
                    {programDone ? (
                      <span className="text-emerald-200">Program complete. You may now unlock & finish.</span>
                    ) : (
                      <span>Select your sanitation option, then run the program.</span>
                    )}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={runProgram}
                    disabled={runningProgram || selectedModes.length === 0}
                  >
                    {runningProgram ? "Running…" : "Run program"}
                  </Button>
                  <Button onClick={unlockFromApp} disabled={busyUnlock || !programDone}>
                    {busyUnlock ? "Unlocking…" : "Unlock & complete"}
                  </Button>
                </div>

                <div className="mt-2 text-xs text-slate-500">
                  For the thesis demo: Fast demo speeds up timers only. Real hardware will use real minutes.
                </div>
              </div>
            </div>
          )}

          {/* QR display (locker QR OR payment QR) */}
          {displayQrPayload && (showLockerQr || showPaymentQr) && (
            <div className="mt-6 grid gap-4 md:grid-cols-2 items-start">
              <div className="rounded-2xl bg-white p-4 text-slate-950 inline-flex justify-center">
                <QRCode value={displayQrPayload as string} size={180} />
              </div>
              <div>
                <div className="font-semibold">{showPaymentQr ? "Payment QR" : "Locker QR"}</div>
                <div className="text-sm text-slate-400">
                  {showPaymentQr ? (
                    <>
                      Pay <b>₱{amount}</b> by scanning this QR in your e-wallet.
                    </>
                  ) : (
                    <>
                      Show this QR to the locker scanner. It is bound to <b>{booking.lockerId}</b> — other lockers should reject it.
                    </>
                  )}
                </div>
                <div className="mt-2 text-xs text-slate-500 break-all">{displayQrPayload}</div>
                <div className="mt-3">
                  <Button variant="secondary" size="sm" onClick={() => copyText(displayQrPayload)}>
                    {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy payload"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Spark-only shortcut */}
          {showSparkPaymentQr && (
            <div className="mt-4 grid gap-4 md:grid-cols-2 items-start">
              <div className="rounded-2xl bg-white p-4 text-slate-950 inline-flex justify-center">
                <QRCode value={paymentQrPayload as string} size={180} />
              </div>
              <div>
                <div className="font-semibold">Payment QR (Spark demo)</div>
                <div className="text-sm text-slate-400">
                  Spark mode is enabled, so this payment QR is shown immediately after reservation for demo-only flows.
                </div>
                <div className="mt-2 text-xs text-slate-500 break-all">{paymentQrPayload}</div>
              </div>
            </div>
          )}

          {/* Terminal state summary */}
          {isTerminal && (
            <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-semibold">Booking finished</div>
                  <div className="text-sm text-slate-400">
                    Status: <span className="text-slate-200 font-semibold">{booking.status}</span>
                    {booking.status === "failed" && (booking as any)?.failReason ? (
                      <> · Reason: <span className="text-rose-200">{String((booking as any).failReason)}</span></>
                    ) : null}
                  </div>
                </div>
                <Badge color={booking.status === "completed" ? "green" : "red"}>{booking.status}</Badge>
              </div>

              <div className="mt-4 flex flex-col md:flex-row gap-2">
                <Button onClick={() => navigate("/app/lockers")}>Reserve another locker</Button>
                <Button variant="secondary" onClick={() => navigate("/app/history")}>View history</Button>
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
