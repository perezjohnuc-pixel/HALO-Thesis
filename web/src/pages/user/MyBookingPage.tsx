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
import Countdown from "../../components/Countdown";

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
    description:
      "Regular locker storage only. Includes 10 hours of locker use. Extra charge applies if exceeded.",
  },
  {
    id: "disinfect_only",
    title: "Disinfect Mode",
    amountDue: 25,
    durationMin: 30,
    selectedModes: ["mist", "fan", "uvc"],
    description:
      "Disinfection support using mist, fan, and UV-C. After sanitation, retrieve within the free pickup time to avoid extra charge.",
  },
  {
    id: "combined",
    title: "Combined Mode",
    amountDue: 30,
    durationMin: 5,
    selectedModes: ["locker", "mist", "fan", "uvc"],
    description:
      "Secure storage plus sanitation support. Includes 5 minutes of locker use for demo. After that, a ₱15 penalty applies per 3-minute block.",
  },
];

const DISINFECT_FREE_PICKUP_MINUTES = Number(
  import.meta.env.VITE_DISINFECT_FREE_PICKUP_MINUTES ?? 30
);

const COMBINED_EXTRA_BLOCK_MINUTES = Number(
  import.meta.env.VITE_COMBINED_EXTRA_BLOCK_MINUTES ?? 3
);

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
  if (amount <= 0) return "Waiting for amount";
  if (amount % 5 === 0) return `Insert ${amount / 5} five-peso coin(s)`;
  return "Insert coins until amount is reached";
}

function isTerminalStatus(status?: string | null) {
  return (
    status === "completed" ||
    status === "cancelled" ||
    status === "expired" ||
    status === "failed"
  );
}

function toMs(ts: any): number | null {
  if (!ts) return null;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  if (ts instanceof Date) return ts.getTime();
  return null;
}

function isBookingCancelable(booking: Booking | null) {
  if (!booking) return false;

  const status = booking.status;
  const paymentConfirmed = (booking as any).paymentConfirmed === true;
  const programStarted = (booking as any).programStarted === true;
  const helmetDetected = (booking as any).helmetDetected === true;

  const earlyCancelableStatuses = [
    "awaiting_booking_qr",
    "confirmed",
    "mode_selected",
    "waiting_for_helmet",
  ];

  const nonCancelableStatuses = [
    "in_use",
    "disinfecting",
    "awaiting_payment",
    "paid",
    "awaiting_retrieval_qr",
    "retrieval_verified",
    "completed",
    "cancelled",
    "expired",
    "failed",
  ];

  return (
    earlyCancelableStatuses.includes(status) &&
    !nonCancelableStatuses.includes(status) &&
    booking.paymentStatus !== "paid" &&
    paymentConfirmed !== true &&
    programStarted !== true &&
    helmetDetected !== true
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
  const [reservationElapsed, setReservationElapsed] = useState(false);
  const [pickupElapsed, setPickupElapsed] = useState(false);
  const [combinedPenaltyTick, setCombinedPenaltyTick] = useState(0);

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

  useEffect(() => {
    setReservationElapsed(false);
    setPickupElapsed(false);
    setCombinedPenaltyTick(0);
  }, [
    booking?.id,
    (booking as any)?.reservationExpiresAt,
    (booking as any)?.unattendedChargeStartsAt,
    (booking as any)?.pickupReadyAt,
    (booking as any)?.programFinishedAt,
    (booking as any)?.billingUpdatedAt,
    (booking as any)?.updatedAt,
    (booking as any)?.endAt,
    booking?.status,
  ]);

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

  const canCancel = isBookingCancelable(booking);

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
        baseAmountDue: option.amountDue,
        extraCharge: 0,
        extraChargeUnits: 0,
        extraChargeReason: "none",
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

    if (!canCancel) {
      setErr(
        "Booking can no longer be cancelled after helmet use or during payment."
      );
      return;
    }

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

  const baseAmountDue =
    typeof (booking as any).baseAmountDue === "number"
      ? (booking as any).baseAmountDue
      : amountDue;

  const extraCharge =
    typeof (booking as any).extraCharge === "number"
      ? (booking as any).extraCharge
      : 0;

  const extraChargeReason = (booking as any).extraChargeReason ?? "none";
  const serviceLabel = getServiceLabel(booking.serviceType);

  const reservationExpiresAtMs = toMs((booking as any).reservationExpiresAt);
  const reservationExpired =
    booking.status === "awaiting_booking_qr" &&
    reservationExpiresAtMs !== null &&
    (Date.now() >= reservationExpiresAtMs || reservationElapsed);

  const pickupReadyAtMs = toMs((booking as any).pickupReadyAt);
  const programFinishedAtMs = toMs((booking as any).programFinishedAt);
  const billingUpdatedAtMs = toMs((booking as any).billingUpdatedAt);
  const updatedAtMs = toMs((booking as any).updatedAt);

  const disinfectPickupBaseMs =
    pickupReadyAtMs ??
    programFinishedAtMs ??
    billingUpdatedAtMs ??
    updatedAtMs ??
    null;

  const unattendedChargeStartsAtMs =
    toMs((booking as any).unattendedChargeStartsAt) ??
    (disinfectPickupBaseMs
      ? disinfectPickupBaseMs + DISINFECT_FREE_PICKUP_MINUTES * 60 * 1000
      : null);

  const showDisinfectPickupTimer =
    booking.status === "awaiting_payment" &&
    booking.serviceType === "disinfect_only" &&
    unattendedChargeStartsAtMs !== null &&
    booking.paymentStatus !== "paid" &&
    booking.paymentConfirmed !== true;

  const pickupPenaltyStarted =
    showDisinfectPickupTimer &&
    unattendedChargeStartsAtMs !== null &&
    (Date.now() >= unattendedChargeStartsAtMs || pickupElapsed);

  const endAtMs = toMs((booking as any).endAt);
  const nowMs = Date.now() + combinedPenaltyTick * 0;
  const combinedPenaltyBlockMs = COMBINED_EXTRA_BLOCK_MINUTES * 60 * 1000;

  const combinedLockerTimeExpired =
    booking.serviceType === "combined" &&
    booking.status === "awaiting_payment" &&
    endAtMs !== null &&
    nowMs >= endAtMs &&
    booking.paymentStatus !== "paid" &&
    booking.paymentConfirmed !== true;

  const combinedPenaltyTargetMs =
    combinedLockerTimeExpired && endAtMs !== null
      ? endAtMs +
        (Math.floor((nowMs - endAtMs) / combinedPenaltyBlockMs) + 1) *
          combinedPenaltyBlockMs
      : null;

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

              <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-yellow-100">
                      QR verification time limit
                    </div>
                    <div className="text-xs text-yellow-200/80">
                      Scan this booking QR within 5 minutes or the reservation
                      will expire and the locker will return to available.
                    </div>
                  </div>

                  <div className="text-2xl font-extrabold text-white">
                    {reservationExpiresAtMs ? (
                      <Countdown
                        targetMs={reservationExpiresAtMs}
                        onElapsed={() => setReservationElapsed(true)}
                      />
                    ) : (
                      "05M:00S"
                    )}
                  </div>
                </div>

                {reservationExpired && (
                  <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                    Reservation time has expired. Refresh the page or go back to
                    Lockers to check if the locker has returned to available
                    status.
                  </div>
                )}
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

          {[
            "mode_selected",
            "waiting_for_helmet",
            "in_use",
            "disinfecting",
          ].includes(booking.status) && (
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

              {showDisinfectPickupTimer && unattendedChargeStartsAtMs !== null && (
                <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-4">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-cyan-100">
                        Pickup countdown before extra charge
                      </div>

                      <div className="text-xs text-cyan-200/80">
                        Retrieve and pay before this timer ends. If the helmet is
                        left unattended after the countdown, an additional ₱10
                        will be added every 30 minutes.
                      </div>
                    </div>

                    <div className="text-2xl font-extrabold text-white">
                      <Countdown
                        targetMs={unattendedChargeStartsAtMs}
                        onElapsed={() => setPickupElapsed(true)}
                      />
                    </div>
                  </div>

                  {pickupPenaltyStarted && (
                    <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                      Pickup time has ended. Extra unattended helmet charge may
                      now apply. Refresh the page or wait for the system update
                      to show the latest amount due.
                    </div>
                  )}
                </div>
              )}

              {combinedLockerTimeExpired && combinedPenaltyTargetMs !== null && (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-red-100">
                        Combined Mode penalty countdown
                      </div>

                      <div className="text-xs text-red-200/80">
                        The 5-minute included locker time has ended. A ₱15
                        additional charge is applied per 3-minute penalty block
                        until payment and retrieval are completed.
                      </div>
                    </div>

                    <div className="text-2xl font-extrabold text-white">
                      <Countdown
                        targetMs={combinedPenaltyTargetMs}
                        onElapsed={() => setCombinedPenaltyTick((v) => v + 1)}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Badge color="amber">Amount due: ₱{amountDue}</Badge>
                <Badge color="blue">{getCoinGuide(amountDue)}</Badge>
                <Badge color="sky">Paid: ₱{amountPaid}</Badge>
              </div>

              {(extraCharge > 0 || baseAmountDue > 0) && (
                <div className="rounded-xl border border-slate-700/50 bg-slate-950/40 p-3 text-xs text-slate-300">
                  <div>Base amount: ₱{baseAmountDue}</div>
                  <div>Additional charge: ₱{extraCharge}</div>
                  {extraChargeReason !== "none" && (
                    <div>Reason: {extraChargeReason.replaceAll("_", " ")}</div>
                  )}
                </div>
              )}

              <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs text-yellow-100">
                Cancellation is disabled at this stage because the locker or
                sanitation service has already been used. Please complete the
                payment to generate the retrieval QR.
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
