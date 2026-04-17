import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { useNavigate, useParams } from "react-router-dom";
import { db } from "../../lib/firebase";
import { userCompleteBooking, userStartProgram } from "../../lib/api";
import { Button, Card, CardBody, CardHeader, Badge } from "../../components/ui";

type BookingDoc = {
  id?: string;
  lockerId?: string;
  status?: string;
  paymentConfirmed?: boolean;
  paymentStatus?: string;
  userControlEnabled?: boolean;
  adminOverride?: boolean;
  permissions?: {
    fan?: boolean;
    uvc?: boolean;
    spray?: boolean;
  };
  deviceStatus?: {
    fan?: boolean;
    uvc?: boolean;
    spray?: boolean;
  };
  selectedModes?: string[];
  sequenceName?: string;
};

type Preset = {
  id: "recommended" | "disinfect" | "fan" | "uvc";
  title: string;
  subtitle: string;
  sequenceName: string;
  selectedModes: string[];
};

const PRESETS: Preset[] = [
  {
    id: "recommended",
    title: "Recommended Preset",
    subtitle: "Best for standard helmet cleaning",
    sequenceName: "recommended_preset",
    selectedModes: ["mist", "dryer", "uvc"],
  },
  {
    id: "disinfect",
    title: "Disinfect",
    subtitle: "Focused sanitation sequence",
    sequenceName: "disinfect",
    selectedModes: ["mist", "uvc"],
  },
  {
    id: "fan",
    title: "Fan Only",
    subtitle: "Drying / airflow only",
    sequenceName: "fan_only",
    selectedModes: ["dryer"],
  },
  {
    id: "uvc",
    title: "UV-C Only",
    subtitle: "UV-C only sequence",
    sequenceName: "uvc_only",
    selectedModes: ["uvc"],
  },
];

export default function UserControlPanelPage() {
  const { bookingId } = useParams();
  const navigate = useNavigate();

  const [booking, setBooking] = useState<BookingDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyPreset, setBusyPreset] = useState<string | null>(null);
  const [busyComplete, setBusyComplete] = useState(false);
  const [lastStartedPreset, setLastStartedPreset] = useState<string | null>(null);
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

  const activePresetLabel = useMemo(() => {
    if (!booking?.sequenceName) return null;

    const matched = PRESETS.find((p) => p.sequenceName === booking.sequenceName);
    return matched?.title ?? booking.sequenceName;
  }, [booking]);

  async function startPreset(preset: Preset) {
    if (!bookingId || !booking) return;
    if (!canUseControls) return;

    try {
      setBusyPreset(preset.id);
      setErr(null);
      setOkMsg(null);

      await userStartProgram({
        bookingId,
        selectedModes: preset.selectedModes,
        sequenceName: preset.sequenceName,
      });

      setLastStartedPreset(preset.title);
      setOkMsg(`${preset.title} started successfully.`);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusyPreset(null);
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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-lg font-bold">Locker Control Panel</div>
              <div className="text-sm text-slate-400">
                Choose a cleaning mode for your active booking.
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

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="text-sm text-slate-400">Booking ID</div>
              <div className="break-all font-mono text-xs">{booking.id}</div>
            </div>

            <div>
              <div className="text-sm text-slate-400">Locker</div>
              <div className="font-semibold">{booking.lockerId ?? "—"}</div>
            </div>
          </div>

          <div className="mt-6 space-y-3 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
            <div>
              <div className="font-semibold">Access status</div>
              <div className="mt-1 text-sm text-slate-400">
                Payment must be confirmed and user controls must be enabled by admin.
              </div>
            </div>

            {!paymentConfirmed && (
              <div className="rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-200">
                Waiting for payment confirmation.
              </div>
            )}

            {paymentConfirmed && booking.userControlEnabled !== true && (
              <div className="rounded-xl border border-blue-500/40 bg-blue-500/10 p-3 text-sm text-blue-200">
                Payment confirmed. Waiting for admin to enable user controls.
              </div>
            )}

            {booking.adminOverride === true && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
                Controls are currently managed by admin.
              </div>
            )}

            {activePresetLabel && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                Current selected program: <b>{activePresetLabel}</b>
              </div>
            )}
          </div>

          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
            <div>
              <div className="font-semibold">Choose cleaning mode</div>
              <div className="mt-1 text-sm text-slate-400">
                Start one of the available presets below.
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {PRESETS.map((preset) => (
                <div
                  key={preset.id}
                  className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4"
                >
                  <div className="font-semibold">{preset.title}</div>
                  <div className="mt-1 text-sm text-slate-400">{preset.subtitle}</div>

                  <div className="mt-3 text-xs text-slate-500">
                    Sequence: {preset.selectedModes.join(" → ")}
                  </div>

                  <div className="mt-4">
                    <Button
                      className="w-full"
                      disabled={!canUseControls || busyPreset !== null}
                      onClick={() => startPreset(preset)}
                    >
                      {busyPreset === preset.id ? "Starting..." : `Start ${preset.title}`}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
            <div>
              <div className="font-semibold">Finish session</div>
              <div className="mt-1 text-sm text-slate-400">
                Use this when the cleaning process is done and you want to complete the booking.
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2 md:flex-row">
              <Button
                variant="secondary"
                disabled={busyComplete}
                onClick={completeBooking}
              >
                {busyComplete ? "Completing..." : "Complete Booking"}
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