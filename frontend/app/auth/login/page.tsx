"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { getSession, login, logout, needsEmailVerification } from "@/lib/auth";
import { Button, FormError, Input, Label } from "@/components/ui";

/** Only allow same-origin path redirects to keep the next= parameter from
 * being abused as an open redirect. */
function safeNext(raw: string | null): string {
  if (!raw) return "/";
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.startsWith("/") && !decoded.startsWith("//")) return decoded;
  } catch {
    // fall through
  }
  return "/";
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="text-sm text-zinc-500">Loading…</div>}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingUser, setExistingUser] = useState<string | null>(null);

  useEffect(() => {
    getSession().then((res) => {
      if (res.meta?.is_authenticated && res.data?.user) {
        setExistingUser(res.data.user.email);
      }
    });
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await login(email, password);
      if (res.status === 409) {
        const me = await getSession();
        setExistingUser(me.data?.user?.email ?? "another account");
        setError("You're already signed in. Sign out first to switch accounts.");
        return;
      }
      if (res.meta?.is_authenticated) {
        router.replace(next);
        router.refresh();
        return;
      }
      if (needsEmailVerification(res)) {
        setError("Please verify your email first. Check your inbox for the confirmation link.");
        return;
      }
      if (res.status === 429) {
        // allauth rate-limit hit (default: 5 failed logins per 15 min per email).
        setError("Too many failed attempts. Please wait a few minutes and try again.");
        return;
      }
      setError(res.errors?.[0]?.message ?? "Invalid email or password");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  if (existingUser) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          You&apos;re already signed in
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          You&apos;re signed in as <strong>{existingUser}</strong>. To switch accounts, sign out first.
        </p>
        <Button
          onClick={async () => {
            await logout();
            setExistingUser(null);
            setError(null);
          }}
        >
          Sign out and switch account
        </Button>
        <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
          <Link className="font-medium text-zinc-900 underline dark:text-zinc-50" href="/">
            Back to home
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Sign in</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Welcome back.</p>
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
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link className="text-xs text-zinc-500 underline dark:text-zinc-400" href="/auth/forgot">
              Forgot?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <FormError message={error} />
        <Button type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
        New to Slotly?{" "}
        <Link className="font-medium text-zinc-900 underline dark:text-zinc-50" href="/auth/register">
          Create an account
        </Link>
      </p>
    </div>
  );
}
