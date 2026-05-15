import { Badge } from "./ui";

export default function StatusPill({ status }: { status?: string | null }) {
  const s = status ?? "unknown";

  const color =
    s === "available" || s === "completed"
      ? "green"
      : s === "awaiting_booking_qr" ||
          s === "reserved" ||
          s === "confirmed" ||
          s === "mode_selected"
        ? "blue"
        : s === "waiting_for_helmet" ||
            s === "awaiting_payment" ||
            s === "awaiting_retrieval_qr" ||
            s === "awaiting_retrieval"
          ? "amber"
          : s === "in_use" ||
              s === "disinfecting" ||
              s === "retrieval_verified" ||
              s === "paid"
            ? "sky"
            : s === "offline" ||
                s === "error" ||
                s === "failed" ||
                s === "cancelled" ||
                s === "expired"
              ? "red"
              : "slate";

  const label = s.replaceAll("_", " ");

  return <Badge color={color as any}>{label}</Badge>;
}
