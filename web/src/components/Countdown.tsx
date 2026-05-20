import React, { useEffect, useMemo, useState } from "react";

function fmt(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}H:${minutes.toString().padStart(2, "0")}M:${seconds
      .toString()
      .padStart(2, "0")}S`;
  }

  return `${minutes.toString().padStart(2, "0")}M:${seconds
    .toString()
    .padStart(2, "0")}S`;
}

export default function Countdown({
  targetMs,
  onElapsed,
}: {
  targetMs: number;
  onElapsed?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const left = useMemo(() => targetMs - now, [targetMs, now]);

  useEffect(() => {
    if (left <= 0) onElapsed?.();
  }, [left, onElapsed]);

  return (
    <span className={left <= 0 ? "text-red-300" : "text-slate-100"}>
      {fmt(left)}
    </span>
  );
}
