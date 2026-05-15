import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { Badge, Card, CardBody, Input, Select } from "../../components/ui";
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
  const [typeFilter, setTypeFilter] = useState("all");

  useEffect(() => {
    const q = query(collection(db, "logs"), orderBy("createdAt", "desc"), limit(500));

    const unsub = onSnapshot(q, (snap) => {
      setLogs(snap.docs.map((d) => withId<LogEvent>(d)));
    });

    return () => unsub();
  }, []);

  const logTypes = useMemo(() => {
    const values = Array.from(new Set(logs.map((l) => l.type).filter(Boolean)));
    return values.sort();
  }, [logs]);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();

    return logs
      .filter((l) => (typeFilter === "all" ? true : l.type === typeFilter))
      .filter((l) => {
        if (!f) return true;

        const hay = `${l.type ?? ""} ${l.message ?? ""} ${l.lockerId ?? ""} ${
          l.bookingId ?? ""
        } ${l.userId ?? ""} ${l.id ?? ""}`.toLowerCase();

        return hay.includes(f);
      });
  }, [logs, filter, typeFilter]);

  return (
    <div className="space-y-6">
      <Card>
        <CardBody>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-base font-semibold">System logs</h2>
              <div className="mt-1 text-xs text-slate-400">
                Latest 500 events in real time. Use this to check QR scans, admin overrides,
                device simulation, payment, and locker reset events.
              </div>
            </div>

            <div className="flex flex-col gap-2 md:flex-row">
              <Select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="all">All types</option>
                {logTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>

              <Input
                placeholder="Filter lockerId, bookingId, userId, type, message..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-3">
        {filtered.map((l) => (
          <Card key={l.id}>
            <CardBody>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge color="blue">{l.type}</Badge>
                    <span className="text-xs text-slate-500">{fmt(l.createdAt)}</span>
                  </div>

                  <span className="break-all font-mono text-xs text-slate-500">
                    {l.id}
                  </span>
                </div>

                <div className="text-sm text-slate-300">{l.message}</div>

                <div className="grid gap-1 text-xs text-slate-500 md:grid-cols-3">
                  <div>
                    Locker:{" "}
                    <span className="font-mono text-slate-300">
                      {l.lockerId ?? "—"}
                    </span>
                  </div>

                  <div>
                    Booking:{" "}
                    <span className="font-mono text-slate-300">
                      {l.bookingId ?? "—"}
                    </span>
                  </div>

                  <div>
                    User:{" "}
                    <span className="font-mono text-slate-300">
                      {l.userId ?? "—"}
                    </span>
                  </div>
                </div>

                {l.payload && (
                  <pre className="mt-2 max-h-48 overflow-auto rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-300">
                    {JSON.stringify(l.payload, null, 2)}
                  </pre>
                )}
              </div>
            </CardBody>
          </Card>
        ))}

        {filtered.length === 0 && (
          <Card>
            <CardBody>
              <div className="text-sm text-slate-400">
                No logs matched your filter.
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
