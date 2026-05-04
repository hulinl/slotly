"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSession, logout, type SessionPayload } from "@/lib/auth";
import { Button } from "@/components/ui";

type State =
  | { kind: "loading" }
  | { kind: "guest" }
  | { kind: "user"; user: NonNullable<SessionPayload["user"]> };

export default function Home() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    getSession().then((res) => {
      if (res.meta?.is_authenticated && res.data?.user) {
        setState({ kind: "user", user: res.data.user });
      } else {
        setState({ kind: "guest" });
      }
    });
  }, []);

  async function onLogout() {
    await logout();
    setState({ kind: "guest" });
  }

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="flex items-center justify-between px-6 py-5">
        <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Slotly</span>
        {state.kind === "user" && (
          <button onClick={onLogout} className="text-sm text-zinc-600 underline dark:text-zinc-400">
            Sign out
          </button>
        )}
      </header>

      <main className="flex flex-1 items-center justify-center px-6 pb-16">
        <div className="w-full max-w-md space-y-6 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Find time to meet — without the calendar Tetris
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Subscribe to your team&apos;s calendars, pick the people you need, and Slotly shows
            every shared free slot in the next 3 months.
          </p>

          {state.kind === "loading" && <p className="text-sm text-zinc-500">Loading…</p>}

          {state.kind === "guest" && (
            <div className="mx-auto flex max-w-xs flex-col gap-2">
              <Link href="/auth/register" className="block">
                <Button>Create your free account</Button>
              </Link>
              <Link href="/auth/login" className="block">
                <Button variant="secondary">Sign in</Button>
              </Link>
            </div>
          )}

          {state.kind === "user" && (
            <div className="mx-auto max-w-sm rounded-lg border border-zinc-200 bg-white p-6 text-left dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Signed in as</p>
              <p className="text-base font-medium text-zinc-900 dark:text-zinc-50">{state.user.email}</p>
              <div className="mt-4 flex flex-col gap-2">
                <Link href="/settings" className="block">
                  <Button variant="secondary">Profile &amp; working hours</Button>
                </Link>
                <Link href="/settings/calendars" className="block">
                  <Button variant="secondary">Calendar subscriptions</Button>
                </Link>
              </div>
              <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                Teams and shared availability search coming next.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
