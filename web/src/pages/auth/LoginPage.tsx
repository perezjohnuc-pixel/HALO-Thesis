import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Input, Label } from "../../components/ui";
import { useAuth } from "../../lib/auth";

export default function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
      nav("/");
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <Label>Email</Label>
        <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
      </div>
      <div>
        <Label>Password</Label>
        <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
      </div>
      {error && <div className="text-sm text-red-300">{error}</div>}
      <Button disabled={busy} className="w-full">Sign in</Button>
      <div className="text-sm text-slate-400">
        No account? <Link className="text-slate-100 underline" to="/auth/register">Create one</Link>
      </div>
    </form>
  );
}
