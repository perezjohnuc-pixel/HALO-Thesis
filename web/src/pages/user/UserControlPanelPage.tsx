import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { useNavigate, useParams } from "react-router-dom";
import { db } from "../../lib/firebase";
import {
  userCompleteBooking,
  userOpenLocker,
  userRequestPayment,
  userStartProgram,
} from "../../lib/api";
import { Button, Card, CardBody, CardHeader, Badge } from "../../components/ui";
import Countdown from "../../components/Countdown";
import StatusPill from "../../components/StatusPill";

type BookingDoc = {
  id?: string;
  userId?: string;
  lockerId?: string;
  status?: string;
  serviceType?: string;
  amountDue?: number;
  amountPaid?: number;
  paymentConfirmed?: boolean;
  paymentStatus?: string;
  selectedModes?: string[];
  sequenceName?: string;
  endAt?: any;

  bookingQrVerified?: boolean;
  helmetDetected?: boolean;
  doorClosed?: boolean;
  programStarted?: boolean;
  programFinished?: boolean;
  programStep?: string;
  programStepEndsAt?: any;
  retrievalQrGenerated?: boolean;
  retrievalQrVerified?: boolean;

  deviceStatus?: {
    lock?: boolean;
    mist?: boolean;
    fan?: boolean;
    uvc?: boolean;
  };
};

function getServiceLabel(serviceType?: string | null) {
  if (serviceType === "locker_only") return "Locker Mode";
  if (serviceType === "disinfect_only") return "Disinfect Mode";
  if (serviceType === "combined") return "Combined Mode";
  return "Not selected";
}

function toMs(ts: any): number | null {
  if (!ts) return null;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  return null;
}

function getStepLabel(step?: string | null) {
  if (step === "awaiting_booking_qr") return "Waiting for booking QR";
  if (step === "choose_mode") return "Choose mode";
  if (step === "waiting_for_helmet" || step === "waiting_helmet") {
    return "Waiting for helmet";
  }
  if (step === "ready_to_start") return "Ready to start";
  if (step === "locker_locked") return "Locker locked";
  if (step === "mist") return "Mist pump running";
  if (step === "fan") return "Fan running";
  if (step === "uvc") return "UV-C running";
  if (step === "awaiting_payment") return "Awaiting payment";
  if (step === "awaiting_retrieval") return "Awaiting retrieval QR";
  if (step === "open") return "Locker opened";
  if (step === "completed") return "Completed";
  return step || "—";
}

function getStartLabel(serviceType?: string | null) {
  if (serviceType === "locker_only") return "Start Locker Mode";
  if (serviceType === "disinfect_only") return "Start Disinfect Mode";
  if (serviceType === "combined") return "Start Combined Mode";
  return "Start";
}

function canUseProcess(status?: string | null) {
  return (
    status === "mode_selected" ||
    status === "waiting_for_helmet" ||
    status === "in_use" ||
    status === "disinfecting"
  );
}

export default function UserControlPanelPage() {
  const { bookingId } = useParams();
  const navigate = useNavigate();

  const [booking, setBooking] = useState<BookingDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyStart, setBusyStart] = useState(false);
  const [busyPayment, setBusyPayment] = useState(false);
  const [busyOpen, setBusyOpen] = useState(false);
  const [busyComplete, setBusyComplete] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!bookingId) return;

    const ref = doc(db, "bookings", bookingId);

    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setBooking(null);
          setLoading(false);
          setErr("Booking not found.");
          return;
        }

        setBooking({ id: snap.id, ...(snap.data() as BookingDoc) });
        setLoading(false);
      },
      (e) => {
        setErr(e.message);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [bookingId]);

  const stepEndsAtMs = useMemo(
    () => toMs(booking?.programStepEndsAt),
    [booking?.programStepEndsAt]
  );

  const endAtMs = useMemo(() => toMs(booking?.endAt), [booking?.endAt]);

  const amountDue = typeof booking?.amountDue === "number" ? booking.amountDue : 0;
  const amountPaid =
    typeof booking?.amountPaid === "number" ? booking.amountPaid : 0;

  const paymentConfirmed =
    booking?.paymentConfirmed === true || booking?.paymentStatus === "paid";

  const modeSelected =
    !!booking?.serviceType &&
    booking.status !== "awaiting_booking_qr" &&
    booking.status !== "confirmed";

  const canStartProgram =
    canUseProcess(booking?.status) &&
    modeSelected &&
    booking?.helmetDetected === true &&
    booking?.doorClosed === true &&
    booking?.programStarted !== true;

  const canProceedToPayment =
    booking?.status === "in_use" &&
    booking?.serviceType === "locker_only" &&
    booking?.programStarted === true &&
    paymentConfirmed !== true;

  const canOpen =
    booking?.status === "retrieval_verified" &&
    booking?.retrievalQrVerified === true &&
    booking?.programStep !== "open";

  const canComplete =
    booking?.retrievalQrVerified === true &&
    booking?.programStep === "open" &&
    booking?.helmetDetected === false &&
    booking?.status === "retrieval_verified";

  async function startProgram() {
    if (!bookingId || !booking) return;

    if (booking.helmetDetected !== true) {
      setErr("Helmet is not detected yet. Place the helmet inside the locker first.");
      return;
    }

    if (booking.doorClosed !== true) {
      setErr("Please close the locker door before starting the selected mode.");
      return;
    }

    try {
      setBusyStart(true);
      setErr(null);
      setOkMsg(null);

      await userStartProgram({ bookingId });
      setOkMsg(`${getStartLabel(booking.serviceType)} started.`);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusyStart(false);
    }
  }

  async function requestPayment() {
    if (!bookingId) return;

    try {
      setBusyPayment(true);
      setErr(null);
      setOkMsg(null);

      await userRequestPayment({ bookingId });
      setOkMsg("Payment step enabled. Please insert coins in the coin slot.");
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusyPayment(false);
    }
  }

  async function openLocker() {
    if (!bookingId) return;

    try {
      setBusyOpen(true);
      setErr(null);
      setOkMsg(null);

      await userOpenLocker({ bookingId });
      setOkMsg("Locker open command sent. Retrieve the helmet before completing the booking.");
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusyOpen(false);
    }
  }

  async function completeBooking() {
    if (!bookingId) return;

    try {
      setBusyComplete(true);
      setErr(null);
      setOkMsg(null);

      await userCompleteBooking({ bookingId });
      setOkMsg("Booking completed. Locker released.");
      navigate("/app/booking");
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusyComplete(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <div className="text-lg font-bold">Locker Control Panel</div>
        </CardHeader>
        <CardBody>
          <div className="text-sm text-slate-400">Loading control panel...</div>
        </CardBody>
      </Card>
    );
  }

  if (!booking) {
    return (
      <Card>
        <CardHeader>
          <div className="text-lg font-bold">Locker Control Panel</div>
        </CardHeader>
        <CardBody>
          <div className="text-sm text-red-300">{err ?? "Booking not found."}</div>
          <div className="mt-4">
            <Button onClick={() => navigate("/app/booking")}>
              Back to My Booking
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  const serviceLabel = getServiceLabel(booking.serviceType);
  const programStep = booking.programStep ?? "—";

  const showLockerTimer =
    (booking.serviceType === "locker_only" ||
      booking.serviceType === "combined") &&
    endAtMs;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-lg font-bold">Locker Control Panel</div>
              <div className="text-sm text-slate-400">
                Start the selected mode, proceed to payment, scan retrieval QR,
                then release the locker.
              </div>
            </div>
            <StatusPill status={booking.status} />
          </div>
        </CardHeader>

        <CardBody>
          {err && <div className="mb-4 text-sm text-red-300">{err}</div>}
          {okMsg && <div className="mb-4 text-sm text-emerald-300">{okMsg}</div>}

          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <div className="text-sm text-slate-400">Booking ID</div>
              <div className="break-all font-mono text-xs">{booking.id}</div>
            </div>

            <div>
              <div className="text-sm text-slate-400">Locker</div>
              <div className="font-semibold">{booking.lockerId ?? "—"}</div>
            </div>

            <div>
              <div className="text-sm text-slate-400">Mode</div>
              <div className="font-semibold">{serviceLabel}</div>
            </div>

            <div>
              <div className="text-sm text-slate-400">Amount</div>
              <div className="font-semibold">
                ₱{amountPaid} / ₱{amountDue}
              </div>
            </div>
          </div>

          {showLockerTimer && (
            <div className="mt-6 rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4">
              <div className="text-sm text-blue-100">Locker time remaining</div>
              <div className="mt-2 text-3xl font-extrabold text-white">
                <Countdown targetMs={endAtMs!} />
              </div>
            </div>
          )}

          <div className="mt-6 grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              <div className="text-xs text-slate-400">Helmet</div>
              <div className="mt-1 font-semibold">
                {booking.helmetDetected ? "Detected" : "Not detected"}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              <div className="text-xs text-slate-400">Door</div>
              <div className="mt-1 font-semibold">
                {booking.doorClosed ? "Closed" : "Open"}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              <div className="text-xs text-slate-400">Program</div>
              <div className="mt-1 font-semibold">{getStepLabel(programStep)}</div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              <div className="text-xs text-slate-400">Retrieval QR</div>
              <div className="mt-1 font-semibold">
                {booking.retrievalQrVerified ? "Verified" : "Not verified"}
              </div>
            </div>
          </div>

          {stepEndsAtMs && ["mist", "fan", "uvc"].includes(programStep) && (
            <div className="mt-6 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-4">
              <div className="text-sm text-cyan-100">Current step countdown</div>
              <div className="mt-2 text-3xl font-extrabold text-white">
                <Countdown targetMs={stepEndsAtMs} />
              </div>
            </div>
          )}

          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
            <div>
              <div className="font-semibold">Start selected mode</div>
              <div className="mt-1 text-sm text-slate-400">
                Place the helmet inside and close the door before pressing Start.
              </div>
            </div>

            {!booking.helmetDetected && (
              <div className="mt-3 rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-200">
                Helmet is not detected yet. Insert the helmet before starting.
              </div>
            )}

            {booking.helmetDetected && !booking.doorClosed && (
              <div className="mt-3 rounded-xl border border-orange-500/40 bg-orange-500/10 p-3 text-sm text-orange-200">
                Helmet detected. Please close the locker door before starting.
              </div>
            )}

            <div className="mt-4 flex flex-col gap-2 md:flex-row">
              <Button disabled={!canStartProgram || busyStart} onClick={startProgram}>
                {busyStart ? "Starting..." : getStartLabel(booking.serviceType)}
              </Button>

              {canProceedToPayment && (
                <Button
                  variant="secondary"
                  disabled={busyPayment}
                  onClick={requestPayment}
                >
                  {busyPayment ? "Preparing..." : "Proceed to Payment"}
                </Button>
              )}
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
            <div>
              <div className="font-semibold">Payment and retrieval</div>
              <div className="mt-1 text-sm text-slate-400">
                After payment, scan the newly generated retrieval QR. The locker
                unlocks only after retrieval QR verification.
              </div>
            </div>

            {booking.status === "awaiting_payment" && (
              <div className="mt-3 rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-200">
                Insert coins until the amount reaches ₱{amountDue}. Current
                recorded payment: ₱{amountPaid}.
              </div>
            )}

            {booking.status === "awaiting_retrieval_qr" && (
              <div className="mt-3 rounded-xl border border-cyan-500/40 bg-cyan-500/10 p-3 text-sm text-cyan-200">
                Payment is complete. Go back to My Booking and scan the retrieval
                QR shown there.
              </div>
            )}

            {booking.status === "retrieval_verified" &&
              booking.programStep !== "open" && (
                <div className="mt-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                  Retrieval QR is verified. The device should unlock automatically.
                  Use Open Locker if a manual command is needed.
                </div>
              )}

            {booking.programStep === "open" && booking.helmetDetected !== false && (
              <div className="mt-3 rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-200">
                Locker is open. Remove the helmet before completing the booking.
              </div>
            )}

            <div className="mt-4 flex flex-col gap-2 md:flex-row">
              <Button disabled={!canOpen || busyOpen} onClick={openLocker}>
                {busyOpen ? "Opening..." : "Open Locker"}
              </Button>

              <Button
                variant="secondary"
                disabled={!canComplete || busyComplete}
                onClick={completeBooking}
              >
                {busyComplete ? "Completing..." : "Complete and Release"}
              </Button>

              <Button variant="secondary" onClick={() => navigate("/app/booking")}>
                Back to My Booking
              </Button>

              <Button variant="secondary" onClick={() => window.location.reload()}>
                Refresh
              </Button>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
            <div className="font-semibold">Device output status</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge color={booking.deviceStatus?.lock ? "amber" : "green"}>
                Lock: {booking.deviceStatus?.lock ? "Locked" : "Unlocked"}
              </Badge>
              <Badge color={booking.deviceStatus?.mist ? "green" : "slate"}>
                Mist: {booking.deviceStatus?.mist ? "ON" : "OFF"}
              </Badge>
              <Badge color={booking.deviceStatus?.fan ? "green" : "slate"}>
                Fan: {booking.deviceStatus?.fan ? "ON" : "OFF"}
              </Badge>
              <Badge color={booking.deviceStatus?.uvc ? "green" : "slate"}>
                UV-C: {booking.deviceStatus?.uvc ? "ON" : "OFF"}
              </Badge>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
