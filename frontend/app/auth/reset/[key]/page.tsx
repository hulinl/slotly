"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { resetPassword } from "@/lib/auth";
import { Button, FormError, Input, Label } from "@/components/ui";

export default function ResetPasswordPage() {
  const router = useRouter();
  const params = useParams<{ key: string }>();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setSubmitting(true);
    let key: string;
    try {
      key = decodeURIComponent(params.key);
    } catch {
      key = params.key;
    }
    try {
      const res = await resetPassword(key, password);
      // allauth-headless returns 200 if the reset auto-logs you in, or 401
      // with flows: [{id: "login"}] meaning "password changed, now log in".
      // Treat any response without an `errors` array as success.
      if (!res.errors) {
        router.replace("/auth/login?reset=ok");
        return;
      }
      setError(
        res.errors?.[0]?.message ??
          "This reset link is invalid or has expired. Request a new one.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Set a new password
        </h1>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm">Confirm new password</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <FormError message={error} />
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : "Save password"}
        </Button>
      </form>
      <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
        <Link className="font-medium text-zinc-900 underline dark:text-zinc-50" href="/auth/login">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
