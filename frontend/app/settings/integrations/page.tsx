"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Plug, Unplug } from "lucide-react";
import { AuthedHeader } from "@/components/AuthedHeader";
import { SettingsNav } from "@/components/SettingsNav";
import { CardSkeleton, PageSkeleton } from "@/components/Skeleton";
import { getSession } from "@/lib/auth";
import {
  GOOGLE_CONNECT_URL,
  disconnectGoogleAccount,
  getGoogleAccount,
  type GoogleAccountStatus,
} from "@/lib/google";

// useSearchParams() forces this subtree out of static prerendering; Next.js 16
// requires it to live below a Suspense boundary so the prerender of the rest
// of the route can still succeed.
export default function IntegrationsPage() {
  return (
    <Suspense
      fallback={
        <PageSkeleton>
          <CardSkeleton rows={3} />
        </PageSkeleton>
      }
    >
      <IntegrationsContent />
    </Suspense>
  );
}

function IntegrationsContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState<string>("");
  const [status, setStatus] = useState<GoogleAccountStatus | null>(null);
  const [busy, setBusy] = useState(false);

  // Callback status arrives via ?google=connected|error&reason=... — keep
  // it in URL state, surface as a one-shot banner, then clean the bar.
  const googleParam = params?.get("google");
  const reason = params?.get("reason");
  const linkedEmail = params?.get("email");

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session.meta?.is_authenticated) {
        router.replace("/auth/login");
        return;
      }
      setEmail(session.data?.user?.email ?? "");
      try {
        setStatus(await getGoogleAccount());
      } catch {
        setStatus({ connected: false });
      }
    })().catch(() => router.replace("/auth/login"));
  }, [router]);

  async function onDisconnect() {
    if (!confirm("Disconnect Google Calendar from Slotly? Existing events stay in your calendar; only Slotly's permission is revoked.")) return;
    setBusy(true);
    try {
      await disconnectGoogleAccount();
      setStatus({ connected: false });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setBusy(false);
    }
  }

  function onConnect() {
    // Top-level navigation — Google won't load inside an iframe and we want
    // the cookie sent on the callback.
    window.location.href = GOOGLE_CONNECT_URL;
  }

  if (status === null) {
    return (
      <PageSkeleton>
        <CardSkeleton rows={3} />
      </PageSkeleton>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <AuthedHeader email={email} />
      <main className="mx-auto max-w-2xl space-y-6 px-6 py-10">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Integrations
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Connect Slotly to your Google Calendar so finding a shared slot
            can create the meeting directly, with everyone invited.
          </p>
        </div>

        <SettingsNav />

        {googleParam === "connected" && (
          <Banner kind="ok">
            Connected{linkedEmail ? ` as ${linkedEmail}` : ""}. You can now
            book meetings directly from the Find slots page.
          </Banner>
        )}
        {googleParam === "error" && (
          <Banner kind="err">
            Connection didn&apos;t go through{reason ? ` (${reason})` : ""}.
            Try again — if it keeps failing, sign out of Google in another
            tab first.
          </Banner>
        )}

        <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <header className="mb-4 flex items-center gap-3">
            <GoogleMark />
            <div className="flex-1">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                Google Calendar
              </h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {status.connected
                  ? `Connected as ${status.google_email}`
                  : "Not connected"}
              </p>
            </div>
            {status.connected ? (
              <button
                type="button"
                onClick={onDisconnect}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
              >
                <Unplug size={14} aria-hidden />
                {busy ? "Disconnecting…" : "Disconnect"}
              </button>
            ) : (
              <button
                type="button"
                onClick={onConnect}
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                <Plug size={14} aria-hidden />
                Connect Google
              </button>
            )}
          </header>

          <ul className="ml-5 list-disc space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
            <li>Slotly only asks for permission to create and check events on your behalf.</li>
            <li>You can disconnect anytime — past events stay in your calendar.</li>
            <li>Revoke from Google at any time at <a className="text-indigo-700 underline dark:text-indigo-300" href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">myaccount.google.com/permissions</a>.</li>
          </ul>
        </section>
      </main>
    </div>
  );
}

function Banner({ kind, children }: { kind: "ok" | "err"; children: React.ReactNode }) {
  const Icon = kind === "ok" ? CheckCircle2 : AlertTriangle;
  const tone =
    kind === "ok"
      ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-100"
      : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100";
  return (
    <div className={`flex items-start gap-2 rounded-md border p-3 text-sm leading-relaxed ${tone}`}>
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden />
      <p>{children}</p>
    </div>
  );
}

function GoogleMark() {
  return (
    <span
      aria-hidden
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950"
    >
      <svg viewBox="0 0 48 48" width="22" height="22">
        <path fill="#4285F4" d="M44 24c0-1.6-.1-2.8-.5-4.1H24v7.7h11.4c-.5 2.8-2.1 5.2-4.5 6.8v5.6h7.3c4.3-3.9 6.8-9.7 6.8-16z" />
        <path fill="#34A853" d="M24 44c6.2 0 11.4-2 15.2-5.6l-7.3-5.6c-2 1.4-4.6 2.3-7.9 2.3-6 0-11.1-4.1-12.9-9.5H3.5v6c3.8 7.5 11.6 12.4 20.5 12.4z" />
        <path fill="#FBBC05" d="M11.1 25.6c-.5-1.4-.7-2.9-.7-4.6s.3-3.2.7-4.6v-6H3.5C1.8 13.7 1 17 1 20.5s.8 6.8 2.5 9.6l7.6-4.5z" />
        <path fill="#EA4335" d="M24 8.6c3.4 0 6.4 1.2 8.8 3.5l6.6-6.6C35.4 2 30.2 0 24 0 15.1 0 7.3 5 3.5 12.4l7.6 6c1.8-5.4 6.9-9.5 12.9-9.5z" />
      </svg>
    </span>
  );
}
