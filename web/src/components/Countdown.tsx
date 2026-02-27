import React, { useEffect, useMemo, useState } from "react";

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

export default function Countdown({
  targetMs,
  onElapsed
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

  return <span className={left <= 0 ? "text-red-300" : "text-slate-100"}>{fmt(left)}</span>;
}
