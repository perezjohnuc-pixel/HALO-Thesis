import React, { useMemo, useState } from "react";
import { Badge, Button, Card, CardBody, CardHeader, Input, Label } from "../../components/ui";
import {
  deviceComplete,
  deviceConfirmPayment,
  deviceVerifyQr,
  expireNow,
  getDeviceKey,
  setDeviceKey,
} from "../../lib/api";

function pretty(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export default function AdminDevicesPage() {
  const [deviceKey, setKey] = useState(getDeviceKey());

  const [verify, setVerify] = useState({ bookingId: "", lockerId: "", token: "", deviceId: "SIM-DEVICE-01" });
  const [pay, setPay] = useState({ lockerId: "", provider: "gcash" as "gcash" | "maya" | "unknown", paymentPayload: "" });
  const [complete, setComplete] = useState({ lockerId: "", success: true, deviceId: "SIM-DEVICE-01" });

  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const ok = useMemo(() => (last && last.ok ? true : false), [last]);

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

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">Device Simulator</div>
            <div className="text-sm text-slate-400">
              For Option B (simulation-only). This page calls your HTTPS Functions endpoints.
            </div>
          </div>
          <Badge color="blue">/api/*</Badge>
        </CardHeader>
        <CardBody className="grid gap-4">
          <div>
            <Label>Device API Key</Label>
            <div className="flex gap-2">
              <Input
                value={deviceKey}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Set the same value in functions/.env (HALO_DEVICE_KEY)"
              />
              <Button
                variant="secondary"
                onClick={() => {
                  setDeviceKey(deviceKey);
                  setLast({ ok: true, message: "Saved to localStorage." });
                }}
              >
                Save
              </Button>
            </div>
            <div className="mt-2 text-xs text-slate-400">
              The backend expects header <span className="text-slate-200">x-halo-device-key</span>. Your web app sends it automatically.
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Card className="md:col-span-1">
              <CardHeader>
                <div className="font-semibold">1) QR scan → Unlock</div>
                <div className="text-xs text-slate-400">Calls: POST /api/verify</div>
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
                    run(() => deviceVerifyQr({
                      bookingId: verify.bookingId,
                      lockerId: verify.lockerId,
                      token: verify.token,
                      deviceId: verify.deviceId,
                    }))
                  }
                >
                  Verify & Unlock
                </Button>
                <div className="text-xs text-slate-400">Expected: status becomes pending_payment (2-minute window).</div>
              </CardBody>
            </Card>

            <Card className="md:col-span-1">
              <CardHeader>
                <div className="font-semibold">2) Payment scan → Start UV</div>
                <div className="text-xs text-slate-400">Calls: POST /api/confirmPayment</div>
              </CardHeader>
              <CardBody className="space-y-2">
                <div>
                  <Label>Locker ID</Label>
                  <Input value={pay.lockerId} onChange={(e) => setPay({ ...pay, lockerId: e.target.value })} />
                </div>
                <div>
                  <Label>Provider</Label>
                  <Input
                    value={pay.provider}
                    onChange={(e) => setPay({ ...pay, provider: (e.target.value as any) ?? "unknown" })}
                    placeholder="gcash | maya | unknown"
                  />
                </div>
                <div>
                  <Label>Payment Payload</Label>
                  <Input
                    value={pay.paymentPayload}
                    onChange={(e) => setPay({ ...pay, paymentPayload: e.target.value })}
                    placeholder="(Simulated) raw QR payload scanned by device"
                  />
                </div>
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      deviceConfirmPayment({
                        lockerId: pay.lockerId,
                        provider: pay.provider,
                        paymentPayload: pay.paymentPayload,
                        deviceId: verify.deviceId,
                      })
                    )
                  }
                >
                  Confirm Payment
                </Button>
                <div className="text-xs text-slate-400">Expected: booking becomes active; device command queued for disinfection.</div>
              </CardBody>
            </Card>

            <Card className="md:col-span-1">
              <CardHeader>
                <div className="font-semibold">3) Complete → Release locker</div>
                <div className="text-xs text-slate-400">Calls: POST /api/complete</div>
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
                    aria-label="Disinfection success"
                    checked={complete.success}
                    onChange={(e) => setComplete({ ...complete, success: e.target.checked })}
                  />
                  <Label htmlFor="ok">Disinfection success</Label>
                </div>
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      deviceComplete({
                        lockerId: complete.lockerId,
                        deviceId: complete.deviceId,
                        success: complete.success,
                      })
                    )
                  }
                >
                  Complete
                </Button>
                <div className="text-xs text-slate-400">Expected: booking becomes completed; locker becomes available.</div>
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
          <div className="font-semibold">How to use this for your thesis demo</div>
          <div className="text-sm text-slate-400">No physical scanner required (Option B)</div>
        </CardHeader>
        <CardBody className="text-sm text-slate-300 space-y-2">
          <div>1) Customer reserves a locker on <span className="text-slate-100">/app/lockers</span>.</div>
          <div>2) Customer opens <span className="text-slate-100">/app/booking</span> and shows the QR.</div>
          <div>3) Admin goes here and inputs bookingId + lockerId + token, then clicks <span className="text-slate-100">Verify & Unlock</span>.</div>
          <div>4) Admin inputs a simulated payment payload and clicks <span className="text-slate-100">Confirm Payment</span> (UV-C can proceed).</div>
          <div>5) Admin clicks <span className="text-slate-100">Complete</span> to release the locker.</div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="font-semibold">Maintenance (Emulator / Spark demos)</div>
          <div className="text-sm text-slate-400">Manual triggers to keep the demo smooth</div>
        </CardHeader>
        <CardBody className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => run(() => expireNow())}>
            Run expiry now
          </Button>
          <div className="text-xs text-slate-400 self-center">
            Expires overdue bookings and releases lockers (same logic as the scheduled job).
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
