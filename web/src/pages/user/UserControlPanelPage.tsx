import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { useNavigate, useParams } from "react-router-dom";
import { db } from "../../lib/firebase";
import { userCompleteBooking, userOpenLocker, userStartProgram } from "../../lib/api";
import { Button, Card, CardBody, CardHeader, Badge } from "../../components/ui";
import Countdown from "../../components/Countdown";

type BookingDoc = {
  id?: string;
  lockerId?: string;
  status?: string;
  paymentConfirmed?: boolean;
  paymentStatus?: string;
  userControlEnabled?: boolean;
  adminOverride?: boolean;
  serviceType?: string;
  amount?: number;
  selectedModes?: string[];
  sequenceName?: string;
  helmetDetected?: boolean;
  programStarted?: boolean;
  programFinished?: boolean;
  programStep?: string;
  programStepEndsAt?: any;
  retrievalQrVerified?: boolean;
  deviceStatus?: {
    lock?: boolean;
    mist?: boolean;
    fan?: boolean;
    uvc?: boolean;
  };
};

type Preset = {
  id: "locker_only" | "disinfect" | "combined";
  title: string;
  subtitle: string;
  sequenceName: string;
  selectedModes: string[];
};

const PRESETS: Preset[] = [
  {
    id: "locker_only",
    title: "Start Locker Session",
    subtitle: "Lock the locker for storage only.",
    sequenceName: "locker_only",
    selectedModes: [],
  },
  {
    id: "disinfect",
    title: "Start Disinfectant",
    subtitle: "Mist 3 minutes, fan 3 minutes, then UV-C 3 minutes.",
    sequenceName: "disinfectant",
    selectedModes: ["mist", "dryer", "uvc"],
  },
  {
    id: "combined",
    title: "Start Combined Process",
    subtitle: "Locker storage with full cleaning sequence.",
    sequenceName: "combined",
    selectedModes: ["mist", "dryer", "uvc"],
  },
];

function getServiceLabel(serviceType?: string | null) {
  if (serviceType === "locker_only") return "Locker Only";
  if (serviceType === "disinfectant") return "Disinfectant Only";
  if (serviceType === "combined") return "Combined";
  return "Locker Service";
}

function toMs(ts: any): number | null {
  if (!ts) return null;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  return null;
}

function getStepLabel(step?: string) {
  if (step === "waiting_payment") return "Waiting for payment";
  if (step === "waiting_helmet") return "Waiting for helmet";
  if (step === "ready_to_start") return "Ready to start";
  if (step === "locker_locked") return "Locker locked";
  if (step === "mist") return "Mist running";
  if (step === "fan") return "Fan running";
  if (step === "uvc") return "UV-C running";
  if (step === "awaiting_retrieval") return "Awaiting QR retrieval";
  if (step === "awaiting_open") return "QR verified";
  if (step === "open") return "Locker opened";
  if (step === "completed") return "Completed";
  return step || "—";
}

export default function UserControlPanelPage() {
  const { bookingId } = useParams();
  const navigate = useNavigate();

  const [booking, setBooking] = useState<BookingDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyPreset, setBusyPreset] = useState<string | null>(null);
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

        setBooking({
          id: snap.id,
          ...(snap.data() as BookingDoc),
        });

        setLoading(false);
      },
      (e) => {
        setErr(e.message);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [bookingId]);

  const paymentConfirmed = useMemo(() => {
    return booking?.paymentConfirmed === true || booking?.paymentStatus === "paid";
  }, [booking]);

  const canUseControls = useMemo(() => {
    return (
      booking?.status === "active" &&
      paymentConfirmed &&
      booking?.userControlEnabled === true &&
      booking?.adminOverride !== true
    );
  }, [booking, paymentConfirmed]);

  const availablePresets = useMemo(() => {
    const serviceType = booking?.serviceType;

    if (serviceType === "locker_only") return PRESETS.filter((p) => p.id === "locker_only");
    if (serviceType === "disinfectant") return PRESETS.filter((p) => p.id === "disinfect");
    if (serviceType === "combined") return PRESETS.filter((p) => p.id === "combined");

    return [];
  }, [booking]);

  const stepEndsAtMs = useMemo(() => toMs(booking?.programStepEndsAt), [booking?.programStepEndsAt]);

  const canStartProgram =
    canUseControls &&
    booking?.helmetDetected === true &&
    booking?.programStarted !== true &&
    booking?.programStep !== "locker_locked";

  const canOpen =
    canUseControls &&
    booking?.retrievalQrVerified === true &&
    booking?.programStep !== "open" &&
    booking?.status === "active";

  async function startPreset(preset: Preset) {
    if (!bookingId || !booking) return;
    if (!canUseControls) return;

    if (booking.helmetDetected !== true) {
      setErr("Helmet is not detected yet. Place the helmet inside the locker first.");
      return;
    }

    try {
      setBusyPreset(preset.id);
      setErr(null);
      setOkMsg(null);

      await userStartProgram({
        bookingId,
        selectedModes: preset.selectedModes,
        sequenceName: preset.sequenceName,
      });

      setOkMsg(`${preset.title} started.`);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusyPreset(null);
    }
  }

  async function openLocker() {
    if (!bookingId) return;

    try {
      setBusyOpen(true);
      setErr(null);
      setOkMsg(null);

      await userOpenLocker({ bookingId });
      setOkMsg("Locker open command sent.");
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusyOpen(false);
    }
  }

  async function completeBooking() {
    if (!bookingId || !booking) return;

    try {
      setBusyComplete(true);
      setErr(null);
      setOkMsg(null);

      await userCompleteBooking({
        bookingId,
        selectedModes: booking.selectedModes ?? [],
        sequenceName: booking.sequenceName ?? "custom",
      });

      setOkMsg("Booking completed. Your locker will be released.");
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
            <Button onClick={() => navigate("/app/booking")}>Back to My Booking</Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  const serviceLabel = getServiceLabel(booking.serviceType);
  const amount = typeof booking.amount === "number" ? booking.amount : 25;
  const programStep = booking.programStep ?? "—";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-lg font-bold">Locker Control Panel</div>
              <div className="text-sm text-slate-400">
                Start the session, scan QR for retrieval, then open and complete the booking.
              </div>
            </div>

            <Badge color={canUseControls ? "green" : "yellow"}>
              {canUseControls ? "Access Enabled" : "Restricted"}
            </Badge>
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
              <div className="text-sm text-slate-400">Service</div>
              <div className="font-semibold">{serviceLabel}</div>
            </div>

            <div>
              <div className="text-sm text-slate-400">Amount Paid</div>
              <div className="font-semibold">₱{amount}</div>
            </div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              <div className="text-xs text-slate-400">Helmet</div>
              <div className="mt-1 font-semibold">
                {booking.helmetDetected ? "Detected" : "Not detected"}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              <div className="text-xs text-slate-400">Program</div>
              <div className="mt-1 font-semibold">{getStepLabel(programStep)}</div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              <div className="text-xs text-slate-400">Lock</div>
              <div className="mt-1 font-semibold">
                {booking.deviceStatus?.lock ? "Locked" : "Unlocked"}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              <div className="text-xs text-slate-400">QR Verification</div>
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
              <div className="font-semibold">Start process</div>
              <div className="mt-1 text-sm text-slate-400">
                Place the helmet inside. When the sensor detects it, press Start.
              </div>
            </div>

            {!booking.helmetDetected && (
              <div className="mt-3 rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-200">
                Helmet is not detected yet. Insert the helmet before starting.
              </div>
            )}

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {availablePresets.map((preset) => (
                <div key={preset.id} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
                  <div className="font-semibold">{preset.title}</div>
                  <div className="mt-1 text-sm text-slate-400">{preset.subtitle}</div>

                  <div className="mt-4">
                    <Button
                      className="w-full"
                      disabled={!canStartProgram || busyPreset !== null}
                      onClick={() => startPreset(preset)}
                    >
                      {busyPreset === preset.id ? "Starting..." : preset.title}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
            <div>
              <div className="font-semibold">Retrieve helmet</div>
              <div className="mt-1 text-sm text-slate-400">
                Scan your personal QR using the ESP32-CAM. After QR verification, press Open Locker.
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2 md:flex-row">
              <Button disabled={!canOpen || busyOpen} onClick={openLocker}>
                {busyOpen ? "Opening..." : "Open Locker"}
              </Button>

              <Button
                variant="secondary"
                disabled={busyComplete}
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
        </CardBody>
      </Card>
    </div>
  );
}
