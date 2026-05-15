import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import QRCode from "react-qr-code";
import { db } from "../../lib/firebase";
import { useAuth } from "../../lib/auth";
import type { Booking, Locker, ServiceType } from "../../lib/types";
import { Button, Card, CardBody, CardHeader, Badge } from "../../components/ui";
import StatusPill from "../../components/StatusPill";

type ModeOption = {
  id: ServiceType;
  title: string;
  amountDue: number;
  durationMin: number;
  selectedModes: string[];
  description: string;
};

const MODE_OPTIONS: ModeOption[] = [
  {
    id: "locker_only",
    title: "Locker Mode",
    amountDue: 25,
    durationMin: 600,
    selectedModes: ["locker"],
    description: "Regular locker storage only. No mist, fan, or UV-C sequence.",
  },
  {
    id: "disinfect_only",
    title: "Disinfect Mode",
    amountDue: 25,
    durationMin: 30,
    selectedModes: ["mist", "fan", "uvc"],
    description: "Disinfection support using the mist pump, fan, and UV-C lamps.",
  },
  {
    id: "combined",
    title: "Combined Mode",
    amountDue: 30,
    durationMin: 600,
    selectedModes: ["locker", "mist", "fan", "uvc"],
    description: "Secure storage plus the complete disinfection sequence.",
  },
];

function getStepIndex(status?: string | null) {
  if (status === "awaiting_booking_qr") return 0;
  if (status === "confirmed") return 1;

  if (
    status === "mode_selected" ||
    status === "waiting_for_helmet" ||
    status === "in_use" ||
    status === "disinfecting"
  ) {
    return 2;
  }

  if (status === "awaiting_payment" || status === "paid") return 3;

  if (status === "awaiting_retrieval_qr" || status === "retrieval_verified") {
    return 4;
  }

  if (
    status === "completed" ||
    status === "cancelled" ||
    status === "expired" ||
    status === "failed"
  ) {
    return 5;
  }

  return 0;
}

function getServiceLabel(serviceType?: string | null) {
  if (serviceType === "locker_only") return "Locker Mode";
  if (serviceType === "disinfect_only") return "Disinfect Mode";
  if (serviceType === "combined") return "Combined Mode";
  return "Not selected yet";
}

function getCoinGuide(amount: number) {
  if (amount === 30) return "Insert six 5-peso coins";
  return "Insert five 5-peso coins";
}

function isTerminalStatus(status?: string | null) {
  return (
    status === "completed" ||
    status === "cancelled" ||
    status === "expired" ||
    status === "failed"
  );
}

export default function MyBookingPage() {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const navigate = useNavigate();

  const [booking, setBooking] = useState<Booking | null>(null);
  const [locker, setLocker] = useState<Locker | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle"
  );
  const [busyMode, setBusyMode] = useState<ServiceType | null>(null);

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
      setLocker(
        snap.exists() ? ({ id: snap.id, ...snap.data() } as Locker) : null
      );
    });
  }, [booking?.lockerId]);

  const bookingQrPayload = useMemo(() => {
    if (!booking?.id || !booking?.lockerId || !booking?.userId) return null;

    return `HALO_BOOK|${booking.id}|${booking.lockerId}|${booking.userId}`;
  }, [booking]);

  const retrievalQrPayload = useMemo(() => {
    if (!booking?.id || !booking?.lockerId) return null;

    if (
      booking.status !== "awaiting_retrieval_qr" &&
      booking.status !== "retrieval_verified"
    ) {
      return null;
    }

    if (booking.paymentStatus !== "paid" && booking.paymentConfirmed !== true) {
      return null;
    }

    if (booking.retrievalQrGenerated !== true) return null;

    const token = booking.retrievalQrToken ?? booking.id;

    return `HALO_RETRIEVE|${booking.id}|${booking.lockerId}|${token}`;
  }, [booking]);

  async function selectMode(option: ModeOption) {
    if (!booking?.id) return;

    try {
      setErr(null);
      setBusyMode(option.id);

      await updateDoc(doc(db, "bookings", booking.id), {
        status: "mode_selected",
        serviceType: option.id,
        selectedModes: option.selectedModes,
        amountDue: option.amountDue,
        durationMin: option.durationMin,
        updatedAt: serverTimestamp(),
      } as any);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusyMode(null);
    }
  }

  async function cancel() {
    if (!booking?.id || !booking?.lockerId) return;

    try {
      setErr(null);

      const bookingRef = doc(db, "bookings", booking.id);
      const lockerRef = doc(db, "lockers", booking.lockerId);
      const batch = writeBatch(db);

      batch.update(bookingRef, {
        status: "cancelled",
        cancelledAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } as any);

      batch.update(lockerRef, {
        status: "available",
        pendingPayment: false,
        occupied: false,
        currentBookingId: null,
        reservedByUserId: null,
        reservationExpiresAt: null,
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

  const stepIdx = getStepIndex(booking.status);
  const isTerminal = isTerminalStatus(booking.status);
  const amountDue = typeof booking.amountDue === "number" ? booking.amountDue : 0;
  const amountPaid =
    typeof booking.amountPaid === "number" ? booking.amountPaid : 0;
  const serviceLabel = getServiceLabel(booking.serviceType);

  const canCancel =
    [
      "awaiting_booking_qr",
      "confirmed",
      "mode_selected",
      "waiting_for_helmet",
      "awaiting_payment",
    ].includes(booking.status) && booking.paymentStatus !== "paid";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-lg font-bold">My booking</div>
              <div className="text-sm text-slate-400">
                Reserve → Scan personal QR → Select mode → Use locker → Pay →
                Scan retrieval QR
              </div>
            </div>

            <StatusPill status={booking.status} />
          </div>

          {/* Mobile-safe step sequence */}
          <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/30 p-3">
            <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
              {[
                { title: "Confirm", desc: "Scan personal QR" },
                { title: "Mode", desc: "Choose service" },
                { title: "Use", desc: "Store / disinfect" },
                { title: "Pay", desc: "Coin slot" },
                { title: "Retrieve", desc: "Scan new QR" },
                { title: "Done", desc: "Reset locker" },
              ].map((s, i) => {
                const done = i < stepIdx;
                const current = i === stepIdx;

                return (
                  <div
                    key={s.title}
                    className="flex min-w-0 flex-col items-center rounded-xl border border-slate-800/70 bg-slate-950/30 px-2 py-3 text-center"
                  >
                    <div
                      className={
                        "flex h-9 w-9 items-center justify-center rounded-full border text-sm font-bold " +
                        (done
                          ? "border-emerald-400/30 bg-emerald-500/20 text-emerald-200"
                          : current
                            ? "border-cyan-400/30 bg-cyan-500/20 text-cyan-200"
                            : "border-slate-700/60 bg-slate-800/60 text-slate-300")
                      }
                    >
                      {done ? "✓" : i + 1}
                    </div>

                    <div className="mt-2 w-full truncate text-xs font-semibold text-slate-200">
                      {s.title}
                    </div>

                    <div className="mt-1 hidden w-full text-[10px] leading-tight text-slate-500 sm:block">
                      {s.desc}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardHeader>

        <CardBody>
          {err && <div className="mb-3 text-sm text-red-300">{err}</div>}

          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <div className="text-sm text-slate-400">Locker</div>
              <div className="font-semibold">
                {locker?.name ?? booking.lockerId}
              </div>
              <div className="text-xs text-slate-500">
                Location: {locker?.location ?? "—"}
              </div>
            </div>

            <div>
              <div className="text-sm text-slate-400">Selected mode</div>
              <div className="font-semibold">{serviceLabel}</div>
              <div className="text-xs text-slate-500">
                Amount due: ₱{amountDue}
              </div>
            </div>

            <div>
              <div className="text-sm text-slate-400">Booking ID</div>
              <div className="break-all font-mono text-xs">{booking.id}</div>
            </div>
          </div>

          {booking.status === "awaiting_booking_qr" && bookingQrPayload && (
            <div className="mt-6 space-y-4 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-4">
              <div>
                <div className="font-semibold">
                  Step 1: Scan personal QR to confirm booking
                </div>

                <div className="text-sm text-slate-300">
                  Show this QR to the locker scanner. Once verified, the
                  electromagnetic lock will unlock for initial access and mode
                  selection.
                </div>
              </div>

              <div className="grid items-start gap-4 md:grid-cols-2">
                <div className="flex justify-center rounded-2xl bg-white p-4 text-slate-950">
                  <QRCode value={bookingQrPayload} size={220} />
                </div>

                <div>
                  <div className="font-semibold">Personal booking QR payload</div>

                  <div className="mt-2 break-all text-xs text-slate-500">
                    {bookingQrPayload}
                  </div>

                  <Button
                    className="mt-3"
                    variant="secondary"
                    size="sm"
                    onClick={() => copyText(bookingQrPayload)}
                  >
                    {copyState === "copied"
                      ? "Copied"
                      : copyState === "failed"
                        ? "Copy failed"
                        : "Copy payload"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {booking.status === "confirmed" && (
            <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
              <div className="font-semibold">Step 2: Select service mode</div>

              <div className="mt-1 text-sm text-slate-400">
                Choose the function you want to use. Payment will happen after
                using the locker or disinfection process.
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {MODE_OPTIONS.map((option) => (
                  <div
                    key={option.id}
                    className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold">{option.title}</div>
                      <Badge color="blue">₱{option.amountDue}</Badge>
                    </div>

                    <div className="mt-2 text-sm text-slate-400">
                      {option.description}
                    </div>

                    <Button
                      className="mt-4 w-full"
                      disabled={busyMode !== null}
                      onClick={() => selectMode(option)}
                    >
                      {busyMode === option.id ? "Saving..." : "Select"}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {["mode_selected", "waiting_for_helmet", "in_use", "disinfecting"].includes(
            booking.status
          ) && (
            <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
              <div className="font-semibold">Step 3: Use locker</div>

              <div className="mt-1 text-sm text-slate-400">
                Place the helmet inside, close the door, and continue to the
                control panel to start the selected mode.
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Badge color={booking.helmetDetected ? "green" : "amber"}>
                  Helmet: {booking.helmetDetected ? "Detected" : "Not detected"}
                </Badge>

                <Badge color={booking.doorClosed ? "green" : "amber"}>
                  Door: {booking.doorClosed ? "Closed" : "Open"}
                </Badge>

                <Badge color="blue">{serviceLabel}</Badge>
              </div>

              <div className="mt-4">
                <Button onClick={() => navigate(`/app/control/${booking.id}`)}>
                  Go to Control Panel
                </Button>
              </div>
            </div>
          )}

          {booking.status === "awaiting_payment" && (
            <div className="mt-6 space-y-3 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-4">
              <div>
                <div className="font-semibold">Step 4: Pay through coin slot</div>

                <div className="text-sm text-slate-300">
                  Insert coins into the locker coin slot. The ESP32 will confirm
                  the payment when the required amount is reached.
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge color="amber">Amount due: ₱{amountDue}</Badge>
                <Badge color="blue">{getCoinGuide(amountDue)}</Badge>
                <Badge color="sky">Paid: ₱{amountPaid}</Badge>
              </div>
            </div>
          )}

          {(booking.status === "awaiting_retrieval_qr" ||
            booking.status === "retrieval_verified") &&
            retrievalQrPayload && (
              <div className="mt-6 space-y-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                <div>
                  <div className="font-semibold">Step 5: Scan retrieval QR</div>

                  <div className="text-sm text-slate-300">
                    Payment is complete. Scan this new QR code through the QR
                    scanner to unlock the locker and retrieve the helmet.
                  </div>
                </div>

                <div className="grid items-start gap-4 md:grid-cols-2">
                  <div className="flex justify-center rounded-2xl bg-white p-4 text-slate-950">
                    <QRCode value={retrievalQrPayload} size={220} />
                  </div>

                  <div>
                    <div className="font-semibold">Retrieval QR payload</div>

                    <div className="mt-2 break-all text-xs text-slate-500">
                      {retrievalQrPayload}
                    </div>

                    <div className="mt-3 flex flex-col gap-2 md:flex-row">
                      <Button onClick={() => navigate(`/app/control/${booking.id}`)}>
                        Go to Control Panel
                      </Button>

                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => copyText(retrievalQrPayload)}
                      >
                        {copyState === "copied"
                          ? "Copied"
                          : copyState === "failed"
                            ? "Copy failed"
                            : "Copy payload"}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

          {isTerminal && (
            <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-semibold">Booking finished</div>

                  <div className="text-sm text-slate-400">
                    Status:{" "}
                    <span className="font-semibold text-slate-200">
                      {booking.status}
                    </span>
                  </div>
                </div>

                <StatusPill status={booking.status} />
              </div>

              <div className="mt-4 flex flex-col gap-2 md:flex-row">
                <Button onClick={() => navigate("/app/lockers")}>
                  Reserve another locker
                </Button>

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
