"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { requestPasswordReset } from "@/lib/auth";
import { Button, FormError, FormSuccess, Input, Label } from "@/components/ui";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await requestPasswordReset(email);
      // allauth returns 200 even when the email is unknown (anti-enumeration).
      if (res.status === 200 || res.status === 401) setDone(true);
      else setError(res.errors?.[0]?.message ?? "Could not send reset email");
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
          Forgot your password?
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Enter your email and we&apos;ll send you a reset link.
        </p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <FormError message={error} />
        <FormSuccess
          message={
            done
              ? "If that email is registered, a reset link is on its way. Check your inbox."
              : null
          }
        />
        <Button type="submit" disabled={submitting || done}>
          {submitting ? "Sending…" : done ? "Sent" : "Send reset link"}
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
