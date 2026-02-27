export function fmtTs(ts: any): string {
  if (!ts) return "";
  let ms: number | null = null;
  if (typeof ts.toMillis === "function") ms = ts.toMillis();
  else if (typeof ts.seconds === "number") ms = ts.seconds * 1000;
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

export function fmtMoneyPHP(amount: number): string {
  // Keep it simple for thesis: always PHP.
  return `₱${Number(amount || 0).toFixed(0)}`;
}