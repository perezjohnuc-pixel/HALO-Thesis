import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Input, Label } from "../../components/ui";
import { useAuth } from "../../lib/auth";

export default function ResetPasswordPage() {
  const { resetPassword } = useAuth();

  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);

    try {
      await resetPassword(email);
      setMessage("Password reset email sent. Please check your inbox.");
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <div className="text-lg font-semibold">Reset password</div>
        <div className="text-sm text-slate-400">
          Enter your email address and we will send a password reset link.
        </div>
      </div>

      <div>
        <Label>Email</Label>
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          required
        />
      </div>

      {error && <div className="text-sm text-red-300">{error}</div>}
      {message && <div className="text-sm text-emerald-300">{message}</div>}

      <Button disabled={busy} className="w-full">
        {busy ? "Sending..." : "Send reset email"}
      </Button>

      <div className="text-sm text-slate-400">
        Remembered your password?{" "}
        <Link className="text-slate-100 underline" to="/auth/login">
          Back to login
        </Link>
      </div>
    </form>
  );
}