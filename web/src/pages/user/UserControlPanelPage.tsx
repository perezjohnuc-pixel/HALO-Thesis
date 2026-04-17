import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot, updateDoc, serverTimestamp } from "firebase/firestore";
import { useNavigate, useParams } from "react-router-dom";
import { db } from "../../lib/firebase";
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
};

export default function UserControlPanelPage() {
  const { bookingId } = useParams();
  const navigate = useNavigate();

  const [booking, setBooking] = useState<BookingDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyDevice, setBusyDevice] = useState<"fan" | "uvc" | "spray" | null>(null);
  const [err, setErr] = useState<string | null>(null);

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

  async function toggleDevice(device: "fan" | "uvc" | "spray") {
    if (!bookingId || !booking) return;
    if (!canUseControls) return;
    if (!booking.permissions?.[device]) return;

    const currentValue = booking.deviceStatus?.[device] ?? false;

    try {
      setBusyDevice(device);
      setErr(null);

      await updateDoc(doc(db, "bookings", bookingId), {
        [`deviceStatus.${device}`]: !currentValue,
        lastUpdatedAt: serverTimestamp(),
      });

      // Optional:
      // If later you want ESP32/backend control, add your API call here.
      // await fetch("/api/device/control", {
      //   method: "POST",
      //   headers: { "Content-Type": "application/json" },
      //   body: JSON.stringify({
      //     bookingId,
      //     device,
      //     value: !currentValue,
      //   }),
      // });
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusyDevice(null);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <div className="text-lg font-bold">Control panel</div>
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
          <div className="text-lg font-bold">Control panel</div>
        </CardHeader>
        <CardBody>
          <div className="text-sm text-red-300">{err ?? "Booking not found."}</div>
          <div className="mt-4">
            <Button onClick={() => navigate("/app/my-booking")}>Back to My Booking</Button>
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
                Control access depends on admin approval.
              </div>
            </div>
            <Badge color={canUseControls ? "green" : "yellow"}>
              {canUseControls ? "Access Enabled" : "Restricted"}
            </Badge>
          </div>
        </CardHeader>

        <CardBody>
          {err && <div className="mb-4 text-sm text-red-300">{err}</div>}

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
          </div>

          <div className="mt-6 space-y-3 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
            <div>
              <div className="font-semibold">Components</div>
              <div className="mt-1 text-sm text-slate-400">
                Only the devices allowed by admin will appear here.
              </div>
            </div>

            {booking.permissions?.fan && (
              <Button
                className="w-full"
                disabled={!canUseControls || busyDevice === "fan"}
                onClick={() => toggleDevice("fan")}
              >
                {busyDevice === "fan"
                  ? "Updating Fan..."
                  : `Fan: ${booking.deviceStatus?.fan ? "ON" : "OFF"}`}
              </Button>
            )}

            {booking.permissions?.uvc && (
              <Button
                className="w-full"
                disabled={!canUseControls || busyDevice === "uvc"}
                onClick={() => toggleDevice("uvc")}
              >
                {busyDevice === "uvc"
                  ? "Updating UV-C..."
                  : `UV-C: ${booking.deviceStatus?.uvc ? "ON" : "OFF"}`}
              </Button>
            )}

            {booking.permissions?.spray && (
              <Button
                className="w-full"
                disabled={!canUseControls || busyDevice === "spray"}
                onClick={() => toggleDevice("spray")}
              >
                {busyDevice === "spray"
                  ? "Updating Spray..."
                  : `Spray: ${booking.deviceStatus?.spray ? "ON" : "OFF"}`}
              </Button>
            )}

            {!booking.permissions?.fan &&
              !booking.permissions?.uvc &&
              !booking.permissions?.spray && (
                <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 text-sm text-slate-400">
                  No component controls are available for this booking yet.
                </div>
              )}
          </div>

          <div className="mt-6 flex flex-col gap-2 md:flex-row">
            <Button variant="secondary" onClick={() => navigate("/app/my-booking")}>
              Back to My Booking
            </Button>
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Refresh
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}