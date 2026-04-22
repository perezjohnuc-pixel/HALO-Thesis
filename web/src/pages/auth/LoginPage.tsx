import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Input, Label } from "../../components/ui";
import { useAuth } from "../../lib/auth";

export default function LoginPage() {
  const { signIn, resetPassword } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  const nav = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
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

  async function onForgotPassword() {
    setError(null);
    setMessage(null);

    if (!email.trim()) {
      setError("Enter your email first, then press Forgot password.");
      return;
    }

    setResetBusy(true);
    try {
      await resetPassword(email);
      setMessage("Password reset email sent. Please check your inbox.");
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <Label>Email</Label>
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          required
        />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <Label>Password</Label>
          <button
            type="button"
            onClick={onForgotPassword}
            disabled={resetBusy}
            className="text-xs text-slate-300 underline disabled:opacity-60"
          >
            {resetBusy ? "Sending..." : "Forgot password?"}
          </button>
        </div>

        <Input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          required
        />
      </div>

      {error && <div className="text-sm text-red-300">{error}</div>}
      {message && <div className="text-sm text-emerald-300">{message}</div>}

      <Button disabled={busy} className="w-full">
        {busy ? "Signing in..." : "Sign in"}
      </Button>

      <div className="text-sm text-slate-400">
        No account?{" "}
        <Link className="text-slate-100 underline" to="/auth/register">
          Create one
        </Link>
      </div>
    </form>
  );
}