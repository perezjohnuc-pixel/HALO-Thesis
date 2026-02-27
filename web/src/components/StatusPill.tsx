import React from "react";
import { Badge } from "./ui";

export default function StatusPill({ status }: { status?: string | null }) {
  const s = status ?? "unknown";
  const color =
    s === "available"
      ? "green"
      : s === "reserved"
        ? "slate"
        : s === "pending_payment"
          ? "amber"
          : s === "active"
            ? "sky"
            : s === "offline" || s === "error"
              ? "red"
              : s === "failed" || s === "cancelled" || s === "expired"
                ? "red"
                : "slate";
  return <Badge color={color as any}>{s}</Badge>;
}
