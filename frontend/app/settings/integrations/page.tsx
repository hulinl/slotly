"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { AuthedHeader } from "@/components/AuthedHeader";
import { ProviderCard, type ProviderStatus } from "@/components/ProviderCard";
import { SettingsNav } from "@/components/SettingsNav";
import { CardSkeleton, PageSkeleton } from "@/components/Skeleton";
import { getSession } from "@/lib/auth";
import {
  GOOGLE_CONNECT_URL,
  MICROSOFT_CONNECT_URL,
  disconnectGoogleAccount,
  disconnectMicrosoftAccount,
  getGoogleAccount,
  getMicrosoftAccount,
  getMicrosoftWritableCalendars,
  getWritableCalendars,
  setMicrosoftWriteCalendar,
  setWriteCalendar,
  type GoogleAccountStatus,
  type MicrosoftAccountStatus,
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
  const [google, setGoogle] = useState<GoogleAccountStatus | null>(null);
  const [ms, setMs] = useState<MicrosoftAccountStatus | null>(null);

  const googleParam = params?.get("google");
  const msParam = params?.get("microsoft");
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
      const [g, m] = await Promise.allSettled([getGoogleAccount(), getMicrosoftAccount()]);
      setGoogle(g.status === "fulfilled" ? g.value : { connected: false });
      setMs(m.status === "fulfilled" ? m.value : { connected: false });
    })().catch(() => router.replace("/auth/login"));
  }, [router]);

  const googleStatus: ProviderStatus | null =
    google === null
      ? null
      : google.connected
        ? {
            connected: true,
            email: google.google_email,
            write_calendar_id: google.write_calendar_id,
          }
        : { connected: false };

  const msStatus: ProviderStatus | null =
    ms === null
      ? null
      : ms.connected
        ? {
            connected: true,
            email: ms.microsoft_email,
            write_calendar_id: ms.write_calendar_id,
          }
        : { connected: false };

  const onDisconnectGoogle = useCallback(async () => {
    await disconnectGoogleAccount();
    setGoogle({ connected: false });
  }, []);
  const onPickGoogleCalendar = useCallback(async (id: string) => {
    setGoogle(await setWriteCalendar(id));
  }, []);

  const onDisconnectMs = useCallback(async () => {
    await disconnectMicrosoftAccount();
    setMs({ connected: false });
  }, []);
  const onPickMsCalendar = useCallback(async (id: string) => {
    setMs(await setMicrosoftWriteCalendar(id));
  }, []);

  if (googleStatus === null || msStatus === null) {
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
            Connect a calendar so people can book directly with you and any
            meeting you create includes an online meeting link automatically.
          </p>
        </div>

        <SettingsNav />

        {googleParam === "connected" && (
          <Banner kind="ok">
            Google connected{linkedEmail ? ` as ${linkedEmail}` : ""}. You can
            now book meetings and receive bookings.
          </Banner>
        )}
        {googleParam === "error" && (
          <Banner kind="err">
            Google connection didn&apos;t go through{reason ? ` (${reason})` : ""}.
            Try again — if it keeps failing, sign out of Google in another tab first.
          </Banner>
        )}
        {msParam === "connected" && (
          <Banner kind="ok">
            Microsoft 365 connected{linkedEmail ? ` as ${linkedEmail}` : ""}. Teams
            links will be added to bookings automatically.
          </Banner>
        )}
        {msParam === "error" && (
          <Banner kind="err">
            Microsoft connection didn&apos;t go through{reason ? ` (${reason})` : ""}.
            Corporate tenants sometimes require an admin to approve the app first.
          </Banner>
        )}

        <ProviderCard
          brand="Google Calendar"
          mark={<GoogleMark />}
          connectUrl={GOOGLE_CONNECT_URL}
          status={googleStatus}
          fetchCalendars={getWritableCalendars}
          onDisconnect={onDisconnectGoogle}
          onPickCalendar={onPickGoogleCalendar}
          disconnectConfirmText="Disconnect Google Calendar from Slotly? Existing events stay in your calendar; only Slotly's permission is revoked."
          revokeHref={{
            label: "myaccount.google.com/permissions",
            href: "https://myaccount.google.com/permissions",
          }}
          footerBullets={[
            "Slotly asks for permission to create and check events on your behalf.",
            "Google Meet links are added to bookings automatically.",
            "You can disconnect anytime — past events stay in your calendar.",
          ]}
        />

        <ProviderCard
          brand="Microsoft 365 / Outlook"
          mark={<MicrosoftMark />}
          connectUrl={MICROSOFT_CONNECT_URL}
          status={msStatus}
          fetchCalendars={getMicrosoftWritableCalendars}
          onDisconnect={onDisconnectMs}
          onPickCalendar={onPickMsCalendar}
          disconnectConfirmText="Disconnect Microsoft 365 from Slotly? Existing events stay in your calendar; only Slotly's permission is revoked."
          revokeHref={{
            label: "myapps.microsoft.com",
            href: "https://myapps.microsoft.com/",
          }}
          footerBullets={[
            "Works with both work/school Microsoft 365 accounts and personal Outlook.com.",
            "Microsoft Teams links are added to bookings automatically.",
            "Corporate tenants may require an admin to approve the app before you can sign in.",
          ]}
        />
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

function MicrosoftMark() {
  return (
    <span
      aria-hidden
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950"
    >
      <svg viewBox="0 0 24 24" width="20" height="20">
        <rect x="1" y="1" width="10" height="10" fill="#F25022" />
        <rect x="13" y="1" width="10" height="10" fill="#7FBA00" />
        <rect x="1" y="13" width="10" height="10" fill="#00A4EF" />
        <rect x="13" y="13" width="10" height="10" fill="#FFB900" />
      </svg>
    </span>
  );
}
