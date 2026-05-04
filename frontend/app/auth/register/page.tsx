"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { signup, needsEmailVerification } from "@/lib/auth";
import { Button, FormError, Input, Label } from "@/components/ui";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await signup(email, password);
      // Email-mandatory mode: API returns 401 with verify_email pending.
      // Anything else (e.g. 200 + authenticated) means we're done.
      if (res.status === 200 || res.meta?.is_authenticated || needsEmailVerification(res)) {
        setDone(true);
      } else {
        setError(res.errors?.[0]?.message ?? "Registration failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Check your email
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          We sent a confirmation link to <strong>{email}</strong>. Click it to verify your address and finish creating
          your account.
        </p>
        <p className="pt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Already verified?{" "}
          <Link className="font-medium underline" href="/auth/login">
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Create your account</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Free, no credit card.</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 10 characters"
          />
        </div>
        <FormError message={error} />
        <Button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create account"}
        </Button>
      </form>
      <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
        Already have an account?{" "}
        <Link className="font-medium text-zinc-900 underline dark:text-zinc-50" href="/auth/login">
          Sign in
        </Link>
      </p>
    </div>
  );
}
