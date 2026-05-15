import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Label,
  Select,
} from "../../components/ui";
import StatusPill from "../../components/StatusPill";
import { db } from "../../lib/firebase";
import type { Booking, ServiceType } from "../../lib/types";

function withId<T>(docSnap: any): T & { id: string } {
  return { id: docSnap.id, ...(docSnap.data?.() ?? {}) };
}

function pretty(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function makeToken() {
  const g = globalThis as any;

  if (g.crypto?.randomUUID) {
    return g.crypto.randomUUID();
  }

  return `token_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function amountForService(serviceType: ServiceType) {
  if (serviceType === "combined") return 30;
  return 25;
}

function durationForService(serviceType: ServiceType) {
  if (serviceType === "disinfect_only") return 30;
  return 600;
}

function selectedModesForService(serviceType: ServiceType) {
  if (serviceType === "locker_only") return ["locker"];
  if (serviceType === "disinfect_only") return ["mist", "fan", "uvc"];
  return ["locker", "mist", "fan", "uvc"];
}

async function addLog(input: {
  type: string;
  message: string;
  lockerId?: string | null;
  bookingId?: string | null;
  userId?: string | null;
  payload?: any;
}) {
  await addDoc(collection(db, "logs"), {
    ...input,
    createdAt: serverTimestamp(),
  });
}

export default function AdminDevicesPage() {
  const [bookings, setBookings] = useState<Array<Booking & { id: string }>>([]);
  const [selectedBookingId, setSelectedBookingId] = useState("");
  const [mode, setMode] = useState<ServiceType>("combined");
  const [amountPaid, setAmountPaid] = useState(30);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, "bookings"),
      orderBy("createdAt", "desc"),
      limit(50)
    );

    return onSnapshot(
      q,
      (snap) => setBookings(snap.docs.map((d) => withId<Booking>(d))),
      (e) => setError(e.message)
    );
  }, []);

  const selectedBooking = useMemo(() => {
    return bookings.find((b) => b.id === selectedBookingId) ?? bookings[0] ?? null;
  }, [bookings, selectedBookingId]);

  useEffect(() => {
    if (!selectedBookingId && bookings[0]?.id) {
      setSelectedBookingId(bookings[0].id);
    }
  }, [bookings, selectedBookingId]);

  const activeBookings = useMemo(() => {
    return bookings.filter((b) =>
      [
        "awaiting_booking_qr",
        "confirmed",
        "mode_selected",
        "waiting_for_helmet",
        "in_use",
        "disinfecting",
        "awaiting_payment",
        "awaiting_retrieval_qr",
        "retrieval_verified",
      ].includes(b.status)
    );
  }, [bookings]);

  async function run(label: string, fn: () => Promise<any>) {
    setError(null);
    setBusy(true);

    try {
      const res = await fn();
      setLast({
        ok: true,
        action: label,
        result: res ?? null,
      });
    } catch (e: any) {
      setLast(null);
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  function requireBooking() {
    if (!selectedBooking) throw new Error("No selected booking.");
    if (!selectedBooking.id) throw new Error("Selected booking has no ID.");
    if (!selectedBooking.lockerId) throw new Error("Selected booking has no locker ID.");
    return selectedBooking;
  }

  async function simulateBookingQr() {
    const b = requireBooking();

    const batch = writeBatch(db);

    batch.update(doc(db, "bookings", b.id), {
      status: "confirmed",
      bookingQrVerified: true,
      bookingQrVerifiedAt: serverTimestamp(),
      programStep: "choose_mode",
      updatedAt: serverTimestamp(),
      deviceStatus: {
        lock: false,
        mist: false,
        fan: false,
        uvc: false,
      },
    } as any);

    batch.update(doc(db, "lockers", b.lockerId), {
      status: "confirmed",
      occupied: true,
      pendingPayment: false,
      currentBookingId: b.id,
      reservedByUserId: b.userId ?? null,
      updatedAt: serverTimestamp(),
    } as any);

    await batch.commit();

    await addLog({
      type: "DEVICE_SIMULATOR",
      bookingId: b.id,
      lockerId: b.lockerId,
      userId: b.userId,
      message: "Simulated personal booking QR scan. Initial locker access unlocked.",
    });

    return {
      bookingId: b.id,
      status: "confirmed",
      lock: "unlocked",
    };
  }

  async function simulateModeSelection() {
    const b = requireBooking();
    const amountDue = amountForService(mode);

    await updateDoc(doc(db, "bookings", b.id), {
      status: "mode_selected",
      serviceType: mode,
      selectedModes: selectedModesForService(mode),
      amountDue,
      durationMin: durationForService(mode),
      programStep: "waiting_for_helmet",
      updatedAt: serverTimestamp(),
    } as any);

    await addLog({
      type: "DEVICE_SIMULATOR",
      bookingId: b.id,
      lockerId: b.lockerId,
      userId: b.userId,
      message: `Simulated mode selection: ${mode}.`,
    });

    return {
      bookingId: b.id,
      serviceType: mode,
      amountDue,
    };
  }

  async function simulateHelmetAndDoor() {
    const b = requireBooking();

    await updateDoc(doc(db, "bookings", b.id), {
      status: "mode_selected",
      helmetDetected: true,
      doorClosed: true,
      helmetDetectedAt: serverTimestamp(),
      doorClosedAt: serverTimestamp(),
      programStep: "ready_to_start",
      updatedAt: serverTimestamp(),
    } as any);

    await addLog({
      type: "DEVICE_SIMULATOR",
      bookingId: b.id,
      lockerId: b.lockerId,
      userId: b.userId,
      message: "Simulated IR sensor: helmet detected and door closed.",
    });

    return {
      bookingId: b.id,
      helmetDetected: true,
      doorClosed: true,
    };
  }

  async function simulateStartProgram() {
    const b = requireBooking();
    const serviceType = (b.serviceType ?? mode) as ServiceType;
    const batch = writeBatch(db);

    if (serviceType === "locker_only") {
      batch.update(doc(db, "bookings", b.id), {
        status: "in_use",
        programStarted: true,
        programStartedAt: serverTimestamp(),
        programFinished: true,
        programFinishedAt: serverTimestamp(),
        programStep: "locker_locked",
        selectedModes: selectedModesForService(serviceType),
        sequenceName: serviceType,
        updatedAt: serverTimestamp(),
        deviceStatus: {
          lock: true,
          mist: false,
          fan: false,
          uvc: false,
        },
      } as any);

      batch.update(doc(db, "lockers", b.lockerId), {
        status: "in_use",
        occupied: true,
        pendingPayment: false,
        updatedAt: serverTimestamp(),
      } as any);
    } else {
      const programRunId = makeToken();

      batch.update(doc(db, "bookings", b.id), {
        status: "disinfecting",
        programStarted: true,
        programStartedAt: serverTimestamp(),
        programFinished: false,
        programRunId,
        programStep: "mist",
        selectedModes: selectedModesForService(serviceType),
        sequenceName: serviceType,
        updatedAt: serverTimestamp(),
        deviceStatus: {
          lock: true,
          mist: true,
          fan: false,
          uvc: false,
        },
      } as any);

      batch.update(doc(db, "lockers", b.lockerId), {
        status: "disinfecting",
        occupied: true,
        pendingPayment: false,
        updatedAt: serverTimestamp(),
      } as any);

      batch.set(doc(db, "deviceCommands", `program_${b.id}`), {
        createdAt: serverTimestamp(),
        lockerId: b.lockerId,
        type: "sanitation_program",
        status: "queued",
        payload: {
          bookingId: b.id,
          programRunId,
          sequenceName: serviceType,
          steps: [
            { id: "mist", label: "Mist Pump", order: 0, seconds: 10 },
            { id: "fan", label: "Fan", order: 1, seconds: 30 },
            { id: "uvc", label: "UV-C", order: 2, seconds: 30 },
          ],
        },
      });
    }

    await batch.commit();

    await addLog({
      type: "DEVICE_SIMULATOR",
      bookingId: b.id,
      lockerId: b.lockerId,
      userId: b.userId,
      message: `Simulated start of ${serviceType}.`,
    });

    return {
      bookingId: b.id,
      serviceType,
      started: true,
    };
  }

  async function simulateProgress(step: "mist" | "fan" | "uvc" | "awaiting_payment") {
    const b = requireBooking();

    const deviceStatus =
      step === "mist"
        ? { lock: true, mist: true, fan: false, uvc: false }
        : step === "fan"
          ? { lock: true, mist: false, fan: true, uvc: false }
          : step === "uvc"
            ? { lock: true, mist: false, fan: false, uvc: true }
            : { lock: true, mist: false, fan: false, uvc: false };

    const bookingPatch: Record<string, any> = {
      programStep: step,
      deviceStatus,
      updatedAt: serverTimestamp(),
    };

    if (step === "awaiting_payment") {
      bookingPatch.status = "awaiting_payment";
      bookingPatch.programFinished = true;
      bookingPatch.programFinishedAt = serverTimestamp();
    }

    const batch = writeBatch(db);

    batch.update(doc(db, "bookings", b.id), bookingPatch as any);

    if (step === "awaiting_payment") {
      batch.update(doc(db, "lockers", b.lockerId), {
        status: "awaiting_payment",
        pendingPayment: true,
        occupied: true,
        updatedAt: serverTimestamp(),
      } as any);
    }

    await batch.commit();

    await addLog({
      type: "DEVICE_SIMULATOR",
      bookingId: b.id,
      lockerId: b.lockerId,
      userId: b.userId,
      message: `Simulated program progress: ${step}.`,
    });

    return {
      bookingId: b.id,
      programStep: step,
    };
  }

  async function simulatePayment() {
    const b = requireBooking();
    const requiredAmount =
      typeof b.amountDue === "number" && b.amountDue > 0
        ? b.amountDue
        : amountForService((b.serviceType ?? mode) as ServiceType);

    const paid = Number(amountPaid || requiredAmount);
    const retrievalQrToken = makeToken();
    const paymentRef = doc(collection(db, "payments"));
    const batch = writeBatch(db);

    batch.set(paymentRef, {
      createdAt: serverTimestamp(),
      userId: b.userId ?? null,
      bookingId: b.id,
      lockerId: b.lockerId,
      provider: "cash",
      paymentMethod: "device_simulator",
      rawPayload: `SIM_CASH_${Date.now()}`,
      status: "paid",
      deviceId: "SIM-DEVICE-01",
      amountPaid: paid,
      requiredAmount,
    });

    batch.update(doc(db, "bookings", b.id), {
      status: "awaiting_retrieval_qr",
      paidAt: serverTimestamp(),
      paymentId: paymentRef.id,
      paymentConfirmed: true,
      paymentStatus: "paid",
      paymentProvider: "cash",
      paymentPayload: `SIM_CASH_${Date.now()}`,
      amountPaid: paid,
      retrievalQrGenerated: true,
      retrievalQrToken,
      retrievalQrVerified: false,
      retrievalQrVerifiedAt: null,
      programStep: "awaiting_retrieval",
      updatedAt: serverTimestamp(),
      deviceStatus: {
        lock: true,
        mist: false,
        fan: false,
        uvc: false,
      },
    } as any);

    batch.update(doc(db, "lockers", b.lockerId), {
      status: "awaiting_retrieval",
      pendingPayment: false,
      occupied: true,
      lastPaymentAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } as any);

    await batch.commit();

    await addLog({
      type: "DEVICE_SIMULATOR",
      bookingId: b.id,
      lockerId: b.lockerId,
      userId: b.userId,
      message: "Simulated coin slot payment and generated retrieval QR.",
    });

    return {
      bookingId: b.id,
      paymentStatus: "paid",
      retrievalQrGenerated: true,
    };
  }

  async function simulateRetrievalQr() {
    const b = requireBooking();
    const batch = writeBatch(db);

    batch.update(doc(db, "bookings", b.id), {
      status: "retrieval_verified",
      retrievalQrVerified: true,
      retrievalQrVerifiedAt: serverTimestamp(),
      programStep: "open",
      updatedAt: serverTimestamp(),
      deviceStatus: {
        lock: false,
        mist: false,
        fan: false,
        uvc: false,
      },
    } as any);

    batch.update(doc(db, "lockers", b.lockerId), {
      status: "awaiting_retrieval",
      occupied: true,
      pendingPayment: false,
      updatedAt: serverTimestamp(),
    } as any);

    await batch.commit();

    await addLog({
      type: "DEVICE_SIMULATOR",
      bookingId: b.id,
      lockerId: b.lockerId,
      userId: b.userId,
      message: "Simulated retrieval QR scan and locker unlock.",
    });

    return {
      bookingId: b.id,
      retrievalQrVerified: true,
      lock: "unlocked",
    };
  }

  async function simulateHelmetRemoved() {
    const b = requireBooking();

    await updateDoc(doc(db, "bookings", b.id), {
      helmetDetected: false,
      helmetDetectedAt: null,
      updatedAt: serverTimestamp(),
    } as any);

    await addLog({
      type: "DEVICE_SIMULATOR",
      bookingId: b.id,
      lockerId: b.lockerId,
      userId: b.userId,
      message: "Simulated helmet removal.",
    });

    return {
      bookingId: b.id,
      helmetDetected: false,
    };
  }

  async function simulateComplete() {
    const b = requireBooking();
    const batch = writeBatch(db);

    batch.update(doc(db, "bookings", b.id), {
      status: "completed",
      completedAt: serverTimestamp(),
      programStep: "completed",
      programFinished: true,
      updatedAt: serverTimestamp(),
      deviceStatus: {
        lock: true,
        mist: false,
        fan: false,
        uvc: false,
      },
    } as any);

    batch.update(doc(db, "lockers", b.lockerId), {
      status: "available",
      occupied: false,
      currentBookingId: null,
      reservedByUserId: null,
      pendingPayment: false,
      reservationExpiresAt: null,
      pendingPaymentExpiresAt: null,
      lastCompletedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } as any);

    await batch.commit();

    await addLog({
      type: "DEVICE_SIMULATOR",
      bookingId: b.id,
      lockerId: b.lockerId,
      userId: b.userId,
      message: "Simulated booking completion and locker reset.",
    });

    return {
      bookingId: b.id,
      completed: true,
      lockerStatus: "available",
    };
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">Admin Device Simulator</div>
            <div className="text-sm text-slate-400">
              Use this page to test the new HALO flow without Arduino.
            </div>
          </div>

          <Badge color="blue">New flow simulator</Badge>
        </CardHeader>

        <CardBody className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2">
              <Label>Selected booking</Label>
              <Select
                value={selectedBookingId}
                onChange={(e) => setSelectedBookingId(e.target.value)}
              >
                {bookings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.id} · {b.status} · {b.lockerId}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label>Mode for simulation</Label>
              <Select
                value={mode}
                onChange={(e) => {
                  const next = e.target.value as ServiceType;
                  setMode(next);
                  setAmountPaid(amountForService(next));
                }}
              >
                <option value="locker_only">Locker Mode</option>
                <option value="disinfect_only">Disinfect Mode</option>
                <option value="combined">Combined Mode</option>
              </Select>
            </div>

            <div>
              <Label>Simulated amount paid</Label>
              <Input
                type="number"
                value={amountPaid}
                onChange={(e) => setAmountPaid(Number(e.target.value))}
              />
            </div>
          </div>

          {selectedBooking && (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-semibold">Current selected booking</div>
                  <div className="mt-1 text-xs text-slate-400">
                    Locker: {selectedBooking.lockerId} · User: {selectedBooking.userId}
                  </div>
                </div>

                <StatusPill status={selectedBooking.status} />
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Badge color={selectedBooking.bookingQrVerified ? "green" : "amber"}>
                  Booking QR:{" "}
                  {selectedBooking.bookingQrVerified ? "verified" : "not verified"}
                </Badge>
                <Badge color="blue">
                  Mode: {selectedBooking.serviceType ?? "not selected"}
                </Badge>
                <Badge color={selectedBooking.helmetDetected ? "green" : "slate"}>
                  Helmet: {selectedBooking.helmetDetected ? "detected" : "not detected"}
                </Badge>
                <Badge color={selectedBooking.paymentStatus === "paid" ? "green" : "amber"}>
                  Payment: {selectedBooking.paymentStatus ?? "unpaid"}
                </Badge>
                <Badge color={selectedBooking.retrievalQrVerified ? "green" : "amber"}>
                  Retrieval QR:{" "}
                  {selectedBooking.retrievalQrVerified ? "verified" : "not verified"}
                </Badge>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="font-semibold">Step-by-step simulation</div>
          <div className="text-sm text-slate-400">
            Follow these buttons from top to bottom to test the whole new flow.
          </div>
        </CardHeader>

        <CardBody className="grid gap-3 md:grid-cols-2">
          <Button
            disabled={busy || !selectedBooking}
            onClick={() => run("SIMULATE_BOOKING_QR", simulateBookingQr)}
          >
            1. Simulate personal booking QR scan
          </Button>

          <Button
            disabled={busy || !selectedBooking}
            variant="secondary"
            onClick={() => run("SIMULATE_MODE_SELECTION", simulateModeSelection)}
          >
            2. Simulate mode selection
          </Button>

          <Button
            disabled={busy || !selectedBooking}
            variant="secondary"
            onClick={() => run("SIMULATE_HELMET_DOOR", simulateHelmetAndDoor)}
          >
            3. Simulate helmet detected + door closed
          </Button>

          <Button
            disabled={busy || !selectedBooking}
            variant="secondary"
            onClick={() => run("SIMULATE_START_PROGRAM", simulateStartProgram)}
          >
            4. Start selected mode
          </Button>

          <Button
            disabled={busy || !selectedBooking}
            variant="secondary"
            onClick={() => run("PROGRAM_MIST", () => simulateProgress("mist"))}
          >
            5A. Program step: mist
          </Button>

          <Button
            disabled={busy || !selectedBooking}
            variant="secondary"
            onClick={() => run("PROGRAM_FAN", () => simulateProgress("fan"))}
          >
            5B. Program step: fan
          </Button>

          <Button
            disabled={busy || !selectedBooking}
            variant="secondary"
            onClick={() => run("PROGRAM_UVC", () => simulateProgress("uvc"))}
          >
            5C. Program step: UV-C
          </Button>

          <Button
            disabled={busy || !selectedBooking}
            variant="secondary"
            onClick={() =>
              run("MOVE_TO_PAYMENT", () => simulateProgress("awaiting_payment"))
            }
          >
            6. Move to payment
          </Button>

          <Button
            disabled={busy || !selectedBooking}
            variant="secondary"
            onClick={() => run("SIMULATE_PAYMENT", simulatePayment)}
          >
            7. Simulate coin slot payment
          </Button>

          <Button
            disabled={busy || !selectedBooking}
            variant="secondary"
            onClick={() => run("SIMULATE_RETRIEVAL_QR", simulateRetrievalQr)}
          >
            8. Simulate retrieval QR scan
          </Button>

          <Button
            disabled={busy || !selectedBooking}
            variant="secondary"
            onClick={() => run("SIMULATE_HELMET_REMOVED", simulateHelmetRemoved)}
          >
            9. Simulate helmet removed
          </Button>

          <Button
            disabled={busy || !selectedBooking}
            variant="secondary"
            onClick={() => run("SIMULATE_COMPLETE", simulateComplete)}
          >
            10. Complete + reset locker
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="font-semibold">Recent active bookings</div>
          <div className="text-sm text-slate-400">
            These are the bookings most likely to need device simulation.
          </div>
        </CardHeader>

        <CardBody>
          <div className="grid gap-2">
            {activeBookings.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setSelectedBookingId(b.id)}
                className={
                  "rounded-xl border p-3 text-left transition " +
                  (selectedBookingId === b.id
                    ? "border-cyan-400/50 bg-cyan-500/10"
                    : "border-slate-800 bg-slate-950/30 hover:border-slate-600")
                }
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="break-all font-mono text-xs">{b.id}</div>
                  <StatusPill status={b.status} />
                </div>

                <div className="mt-1 text-xs text-slate-400">
                  Locker: {b.lockerId} · Mode: {b.serviceType ?? "not selected"}
                </div>
              </button>
            ))}

            {activeBookings.length === 0 && (
              <div className="text-sm text-slate-400">
                No active bookings to simulate.
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {(error || last) && (
        <Card>
          <CardHeader>
            <div className="font-semibold">Last simulator result</div>
          </CardHeader>

          <CardBody>
            {error && <div className="mb-3 text-sm text-red-300">{error}</div>}

            <pre className="max-h-72 overflow-auto rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-200">
              {pretty(last)}
            </pre>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
