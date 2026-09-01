"use client";

/**
 * Post-signup nudge to connect a booking provider. Shown once per
 * (user, provider-status) combo; dismissal is remembered in localStorage
 * so the banner stops nagging after the user has actively said "not now".
 *
 * Automatically hides itself when the user has any writable provider
 * connected — no polling; a re-render triggered by a route change or
 * the settings page redirects back naturally invalidates it.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { CalendarCheck, X } from "lucide-react";
import { hasWritableProvider } from "@/lib/google";

const DISMISS_KEY = "slotly.onboarding.connectCalendar.dismissed";

export function OnboardingBanner() {
  // 'unknown' during the initial async check so we don't flash the banner
  // on every route change before we know whether the user needs it.
  const [state, setState] = useState<"unknown" | "hidden" | "show">("unknown");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(DISMISS_KEY) === "1") {
      setState("hidden");
      return;
    }
    let alive = true;
    hasWritableProvider()
      .then((ok) => {
        if (alive) setState(ok ? "hidden" : "show");
      })
      .catch(() => {
        if (alive) setState("hidden");
      });
    return () => {
      alive = false;
    };
  }, []);

  if (state !== "show") return null;

  function dismiss() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DISMISS_KEY, "1");
    }
    setState("hidden");
  }

  return (
    <div className="border-b border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-800/60 dark:bg-indigo-950/40 dark:text-indigo-100">
      <div className="mx-auto flex max-w-6xl items-start gap-3 px-4 py-2.5 text-sm sm:px-6">
        <CalendarCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="flex-1">
          <span className="font-medium">
            Connect your calendar to start accepting bookings.
          </span>{" "}
          <span className="text-indigo-800 dark:text-indigo-200/80">
            One click and people can book time with you from your public link.
          </span>{" "}
          <Link
            href="/settings/integrations"
            className="whitespace-nowrap font-semibold underline underline-offset-2 hover:no-underline"
          >
            Connect now →
          </Link>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-indigo-700 hover:bg-indigo-100 dark:text-indigo-200 dark:hover:bg-indigo-900/40"
        >
          <X size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}
