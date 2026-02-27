import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Card, CardBody, CardHeader, Input, Label } from "../../components/ui";
import { useAuth } from "../../lib/auth";

export default function RegisterPage() {
  const { register } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="text-lg font-bold">Create your account</div>
          <div className="text-sm text-slate-400">Customer-ready sign up</div>
        </CardHeader>
        <CardBody className="space-y-3">
          {err && <div className="text-sm text-red-300">{err}</div>}

          <div className="space-y-1">
            <Label>Display name</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
          </div>

          <div className="space-y-1">
            <Label>Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@email.com" />
          </div>

          <div className="space-y-1">
            <Label>Password</Label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="••••••••" />
          </div>

          <Button
            className="w-full"
            disabled={busy}
            onClick={async () => {
              setErr(null);
              setBusy(true);
              try {
                await register(email.trim(), password, displayName.trim() || undefined);
                nav("/");
              } catch (e: any) {
                setErr(e?.message ?? String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Creating…" : "Create account"}
          </Button>

          <div className="text-sm text-slate-400">
            Already have an account? <Link className="text-slate-200 underline" to="/login">Login</Link>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
