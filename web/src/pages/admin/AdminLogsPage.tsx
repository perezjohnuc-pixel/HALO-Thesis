import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { Card, CardBody, Input } from "../../components/ui";
import { db } from "../../lib/firebase";
import type { LogEvent } from "../../lib/types";

function withId<T>(d: any): T & { id: string } {
  return { id: d.id, ...(d.data?.() ?? {}) };
}

function fmt(ts?: any) {
  const ms = ts?.toMillis?.();
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<Array<LogEvent & { id: string }>>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const q = query(collection(db, "logs"), orderBy("createdAt", "desc"), limit(300));
    const unsub = onSnapshot(q, (snap) => {
      setLogs(snap.docs.map((d) => withId<LogEvent>(d)));
    });
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return logs;
    return logs.filter((l) => {
      const hay = `${l.type ?? ""} ${l.message ?? ""} ${l.lockerId ?? ""} ${l.userId ?? ""} ${l.id ?? ""}`.toLowerCase();
      return hay.includes(f);
    });
  }, [logs, filter]);

  return (
    <div className="space-y-6">
      <Card>
        <CardBody>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-base font-semibold">System logs</h2>
              <div className="mt-1 text-xs text-slate-400">Latest 300 events (real-time)</div>
            </div>
            <Input
              placeholder="Filter (lockerId, userId, type, message...)"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-3">
        {filtered.map((l) => (
          <Card key={l.id}>
            <CardBody>
              <div className="flex flex-col gap-1">
                <div className="text-sm font-semibold text-slate-100">
                  {l.type} <span className="text-slate-600">· {fmt(l.createdAt)}</span>
                </div>
                <div className="text-sm text-slate-300">{l.message}</div>
                <div className="text-xs text-slate-500">
                  Locker: {l.lockerId ?? "—"} · User: {l.userId ?? "—"} · Log ID: {l.id}
                </div>
              </div>
            </CardBody>
          </Card>
        ))}

        {filtered.length === 0 && (
          <Card>
            <CardBody>
              <div className="text-sm text-slate-400">No logs matched your filter.</div>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
