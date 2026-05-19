"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Copy,
  ExternalLink,
  HelpCircle,
  RefreshCw,
  Share2,
} from "lucide-react";
import { AuthedHeader } from "@/components/AuthedHeader";
import { SettingsNav } from "@/components/SettingsNav";
import { ProviderBadge } from "@/components/ProviderBadge";
import { CardSkeleton, ListSkeleton, PageSkeleton } from "@/components/Skeleton";
import { Button, FormError, FormSuccess, Input, Label } from "@/components/ui";
import { getSession } from "@/lib/auth";
import {
  type Calendar,
  type CalendarProvider,
  CalendarApiError,
  createCalendar,
  deleteCalendar,
  listCalendars,
  rotateBridgeToken,
  syncCalendar,
  updateCalendar,
} from "@/lib/calendars";

const PROVIDER_LABEL: Record<CalendarProvider, string> = {
  google: "Google",
  apple: "Apple iCloud",
  outlook: "Outlook",
  other: "ICS",
};

const STATUS_BADGE: Record<Calendar["status"], { label: string; className: string }> = {
  ok: {
    label: "OK",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  syncing: {
    label: "Syncing…",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  },
  sync_failing: {
    label: "Sync failing",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  },
  unreachable: {
    label: "Unreachable",
    className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  },
};

export default function CalendarsPage() {
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session.meta?.is_authenticated) {
        router.replace("/auth/login");
        return;
      }
      setEmail(session.data?.user?.email ?? "");
      setCalendars(await listCalendars());
      setLoaded(true);
    })().catch(() => router.replace("/auth/login"));
  }, [router]);

  // While any calendar is in the transient "syncing" state, refresh the
  // list every 3s so the badge flips to OK / sync_failing as soon as the
  // worker finishes — no manual reload needed.
  useEffect(() => {
    const anySyncing = calendars.some((c) => c.status === "syncing");
    if (!anySyncing) return;
    const t = setInterval(async () => {
      try {
        const fresh = await listCalendars();
        setCalendars(fresh);
      } catch {
        /* transient — try again */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [calendars]);

  if (!loaded) {
    return (
      <PageSkeleton>
        <CardSkeleton rows={3} />
        <ListSkeleton rows={3} className="mt-6" />
      </PageSkeleton>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <AuthedHeader email={email} />

      <main className="mx-auto max-w-2xl space-y-6 px-6 py-10">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Calendar subscriptions
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Slotly reads only free/busy times — never event titles, descriptions, or attendees.
            Polling cadence: every 5 minutes.
          </p>
        </div>

        <SettingsNav />

        <AddCalendarForm
          onAdded={(cal) => setCalendars((prev) => [cal, ...prev.filter((c) => c.id !== cal.id)])}
        />

        <BusyRulesHelp />

        <CalendarList
          calendars={calendars}
          onChange={setCalendars}
        />
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AddCalendarForm({ onAdded }: { onAdded: (cal: Calendar) => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const created = await createCalendar({ name, url });
      setSuccess(
        "Saved. Slotly is reading the calendar — it'll appear in your free/busy data in a few seconds.",
      );
      onAdded(created);
      setName("");
      setUrl("");
    } catch (err) {
      if (err instanceof CalendarApiError) {
        const fields = err.fields;
        const firstError =
          (typeof fields.url === "string" && fields.url) ||
          (Array.isArray(fields.url) && String(fields.url[0])) ||
          (typeof fields.name === "string" && fields.name) ||
          (Array.isArray(fields.name) && String(fields.name[0])) ||
          err.message;
        setError(String(firstError));
      } else {
        setError(err instanceof Error ? err.message : "Network error");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <header className="mb-5">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Add a calendar</h2>
        <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
          Paste your private iCal/ICS URL — find it in your provider&apos;s settings.
        </p>
      </header>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="cal-name">Display name</Label>
          <Input
            id="cal-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Work, Personal…"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cal-url">ICS URL</Label>
          <Input
            id="cal-url"
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…/basic.ics or webcal://…"
          />
          <ProviderHelp />
        </div>
        <FormError message={error} />
        <FormSuccess message={success} />
        <Button type="submit" disabled={submitting} className="sm:w-auto sm:px-6">
          {submitting ? "Connecting…" : "Connect calendar"}
        </Button>
      </form>
    </section>
  );
}

function BusyRulesHelp() {
  return (
    <details className="group/help overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-zinc-900 dark:text-zinc-100 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
        <HelpCircle size={16} className="shrink-0" aria-hidden="true" />
        <span className="flex-1">What counts as &ldquo;busy&rdquo; in Slotly?</span>
        <ChevronDown
          size={16}
          className="shrink-0 transition-transform group-open/help:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="space-y-3 border-t border-zinc-200 px-4 py-3 text-sm text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
        <p>
          When Slotly searches for free time, it intersects everyone&apos;s
          working hours and subtracts their busy intervals. An event from
          your calendar counts as &ldquo;busy&rdquo; when:
        </p>
        <ul className="ml-4 list-disc space-y-1">
          <li>It&apos;s inside the search window <em>and</em> not cancelled.</li>
          <li>
            It&apos;s either marked <strong>busy</strong> by your calendar
            (default for normal time-bound events) <strong>or</strong> it&apos;s
            an <strong>all-day event</strong>. All-day events block the whole
            day even if your calendar marks them &ldquo;free&rdquo; — typical
            use is vacation, sick day, or out-of-office.
          </li>
          <li>
            Manual <em>Unavailability</em> blocks (Profile → Unavailability)
            also count and are independent of any calendar.
          </li>
        </ul>
        <p>
          What does <em>not</em> block: events you marked &ldquo;Show as
          free&rdquo; in your calendar (e.g. a lunch reminder), cancelled
          events, and tentative events whose calendar marks them transparent.
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Slotly never reads event titles, descriptions, or attendees — only
          start/end and busy/free flags.
        </p>
      </div>
    </details>
  );
}

function ProviderHelp() {
  return (
    <details className="group/help overflow-hidden rounded-lg border border-indigo-200 bg-indigo-50/60 dark:border-indigo-900/60 dark:bg-indigo-950/20">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-indigo-900 transition-colors hover:bg-indigo-100/60 dark:text-indigo-100 dark:hover:bg-indigo-950/40">
        <HelpCircle size={16} className="shrink-0" aria-hidden="true" />
        <span className="flex-1">How do I find my ICS URL?</span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="shrink-0 text-indigo-600 transition-transform group-open/help:rotate-180 dark:text-indigo-300"
        />
      </summary>
      <div className="space-y-3 border-t border-indigo-200/70 bg-white/80 p-4 dark:border-indigo-900/60 dark:bg-zinc-900/60">
        <ProviderHelpCard
          provider="google"
          name="Google Calendar"
          steps={[
            <>
              Open{" "}
              <ExtLink href="https://calendar.google.com/calendar/u/0/r/settings">
                Google Calendar settings
              </ExtLink>{" "}
              and pick the calendar you want to share.
            </>,
            <>
              Scroll to <em>Integrate calendar</em> →{" "}
              <em>Secret address in iCal format</em>.
            </>,
            "Copy that URL and paste it above.",
          ]}
        />

        <ProviderHelpCard
          provider="outlook"
          name="Microsoft 365 / Outlook"
          steps={[
            <>
              Open{" "}
              <ExtLink href="https://outlook.office.com/calendar/options/calendar/SharedCalendars">
                Outlook web → Settings → Shared calendars
              </ExtLink>
              .
            </>,
            <>
              Under <em>Publish a calendar</em>, pick the calendar (usually
              &quot;Calendar&quot;) and choose <em>Can view all details</em>.
              Click <em>Publish</em>.
            </>,
            <>
              Two links appear — copy the one that ends in{" "}
              <Code>.ics</Code> and paste it above.
            </>,
          ]}
        >
          <Alert>
            <strong>Heads up:</strong> many corporate Microsoft 365 tenants
            disable calendar publishing by IT policy. If{" "}
            <em>Publish a calendar</em> is missing or greyed out, ask your
            admin or use a personal Outlook.com account — we&apos;ll add OAuth
            login (which doesn&apos;t need publishing) in a later release.
          </Alert>
        </ProviderHelpCard>

        <ProviderHelpCard
          provider="apple"
          name="Apple iCloud"
          steps={[
            <>
              Sign in to{" "}
              <ExtLink href="https://www.icloud.com/calendar">icloud.com/calendar</ExtLink>.
            </>,
            <>
              Hover the calendar in the left sidebar → click the share icon →
              toggle <em>Public Calendar</em>.
            </>,
            <>
              Click <em>Copy Link</em>. If the URL starts with{" "}
              <Code>webcal://</Code> we&apos;ll convert it automatically.
            </>,
          ]}
        />

        <ProviderHelpCard
          provider="other"
          name="Other / generic ICS"
          intro={
            <>
              Any HTTPS URL ending in <Code>.ics</Code> that returns valid
              iCalendar (RFC 5545) data works. Slotly polls it every 5 minutes.
            </>
          }
        />
      </div>
    </details>
  );
}

function ProviderHelpCard({
  provider,
  name,
  steps,
  intro,
  children,
}: {
  provider: "google" | "outlook" | "apple" | "other";
  name: string;
  steps?: React.ReactNode[];
  intro?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <header className="mb-2 flex items-center gap-2">
        <ProviderBadge provider={provider} size={28} />
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{name}</h3>
      </header>
      {intro && (
        <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{intro}</p>
      )}
      {steps && (
        <ol className="space-y-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          {steps.map((step, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                {i + 1}
              </span>
              <span className="flex-1">{step}</span>
            </li>
          ))}
        </ol>
      )}
      {children}
    </section>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-0.5 font-medium text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:decoration-indigo-500 dark:text-indigo-300 dark:decoration-indigo-700"
    >
      {children}
      <ExternalLink size={12} className="shrink-0" aria-hidden="true" />
    </a>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-[0.85em] text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
      {children}
    </code>
  );
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm leading-relaxed text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
      <AlertTriangle
        size={16}
        className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
        aria-hidden="true"
      />
      <p>{children}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function CalendarList({
  calendars,
  onChange,
}: {
  calendars: Calendar[];
  onChange: (next: Calendar[]) => void;
}) {
  if (calendars.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
        No calendars connected yet. Add one above to get started.
      </section>
    );
  }
  return (
    <section className="space-y-3">
      {calendars.map((c) => (
        <CalendarRow
          key={c.id}
          calendar={c}
          onUpdated={(updated) => onChange(calendars.map((x) => (x.id === updated.id ? updated : x)))}
          onDeleted={() => onChange(calendars.filter((x) => x.id !== c.id))}
        />
      ))}
    </section>
  );
}

function CalendarRow({
  calendar,
  onUpdated,
  onDeleted,
}: {
  calendar: Calendar;
  onUpdated: (c: Calendar) => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState<"sync" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSync() {
    setError(null);
    setBusy("sync");
    try {
      onUpdated(await syncCalendar(calendar.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(null);
    }
  }

  async function onDelete() {
    if (!confirm(`Remove "${calendar.name}"? This deletes its cached events from Slotly.`)) return;
    setBusy("delete");
    try {
      await deleteCalendar(calendar.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setBusy(null);
    }
  }

  const lastSynced = calendar.last_synced_at
    ? new Date(calendar.last_synced_at).toLocaleString()
    : "never";
  const badge = STATUS_BADGE[calendar.status];

  return (
    <article className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start gap-4">
        <ProviderBadge provider={calendar.provider} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium text-zinc-900 dark:text-zinc-50">{calendar.name}</h3>
            <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
              {PROVIDER_LABEL[calendar.provider]}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs ${badge.className}`}>{badge.label}</span>
          </div>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Last synced: {lastSynced}</p>
          {calendar.last_error && calendar.status !== "ok" && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-300">{calendar.last_error}</p>
          )}
          {calendar.sync && calendar.sync.status_code === 200 && (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Last fetch: {calendar.sync.written} events stored
              {typeof calendar.sync.deleted === "number" && `, ${calendar.sync.deleted} replaced`}.
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={onSync}
            disabled={busy !== null}
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {busy === "sync" ? "Syncing…" : "Sync now"}
          </button>
          <button
            onClick={onDelete}
            disabled={busy !== null}
            className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
          >
            {busy === "delete" ? "Removing…" : "Remove"}
          </button>
        </div>
      </div>
      {error && <p className="mt-3 text-xs text-red-600 dark:text-red-300">{error}</p>}
      <BridgeSection calendar={calendar} onUpdated={onUpdated} />
    </article>
  );
}

// ---------------------------------------------------------------------------

const COMMON_TIMEZONES = [
  "Europe/Prague",
  "Europe/Berlin",
  "Europe/Vienna",
  "Europe/London",
  "Europe/Paris",
  "Europe/Warsaw",
  "Europe/Budapest",
  "Europe/Bucharest",
  "Europe/Istanbul",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "UTC",
];

function BridgeSection({
  calendar,
  onUpdated,
}: {
  calendar: Calendar;
  onUpdated: (c: Calendar) => void;
}) {
  const [open, setOpen] = useState(calendar.bridge_enabled);
  const [busy, setBusy] = useState<"toggle" | "tz" | "rotate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [tz, setTz] = useState(calendar.source_timezone || "Europe/Prague");

  async function setEnabled(next: boolean) {
    setError(null);
    setBusy("toggle");
    try {
      const updated = await updateCalendar(calendar.id, {
        bridge_enabled: next,
        source_timezone: tz,
      });
      onUpdated(updated);
      if (next) setOpen(true);
    } catch (err) {
      setError(extractErr(err, "Couldn't update bridge"));
    } finally {
      setBusy(null);
    }
  }

  async function saveTz(value: string) {
    setError(null);
    setTz(value);
    if (!calendar.bridge_enabled) return;
    setBusy("tz");
    try {
      const updated = await updateCalendar(calendar.id, { source_timezone: value });
      onUpdated(updated);
    } catch (err) {
      setError(extractErr(err, "Couldn't save timezone"));
    } finally {
      setBusy(null);
    }
  }

  async function onRotate() {
    if (!confirm("Generate a new bridge URL? The old one will stop working immediately.")) return;
    setError(null);
    setBusy("rotate");
    try {
      onUpdated(await rotateBridgeToken(calendar.id));
    } catch (err) {
      setError(extractErr(err, "Couldn't rotate token"));
    } finally {
      setBusy(null);
    }
  }

  async function onCopy() {
    if (!calendar.bridge_url) return;
    try {
      await navigator.clipboard.writeText(calendar.bridge_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Copy failed — select the URL manually.");
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-950/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-zinc-800 dark:text-zinc-100"
      >
        <Share2 size={16} className="shrink-0 text-indigo-600 dark:text-indigo-300" aria-hidden />
        <span className="flex-1">Bridge to Google Calendar</span>
        {calendar.bridge_enabled && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            On
          </span>
        )}
        <ChevronDown
          size={16}
          className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open && (
        <div className="space-y-4 border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            Outlook&apos;s published feeds use Windows-style timezone names that
            Google Calendar ignores, causing times to display shifted. Turn this
            on and we&apos;ll re-serve the calendar with IANA timezones — paste
            the resulting URL into Google&apos;s &quot;From URL&quot; option.
          </p>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor={`tz-${calendar.id}`}>Calendar timezone</Label>
              <select
                id={`tz-${calendar.id}`}
                value={tz}
                onChange={(e) => saveTz(e.target.value)}
                disabled={busy !== null}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              >
                {COMMON_TIMEZONES.includes(tz) ? null : <option value={tz}>{tz}</option>}
                {COMMON_TIMEZONES.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => setEnabled(!calendar.bridge_enabled)}
              disabled={busy !== null}
              className={`h-9 rounded-md px-4 text-sm font-medium disabled:opacity-50 ${
                calendar.bridge_enabled
                  ? "border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  : "bg-indigo-600 text-white hover:bg-indigo-700"
              }`}
            >
              {busy === "toggle"
                ? "Saving…"
                : calendar.bridge_enabled
                  ? "Disable bridge"
                  : "Enable bridge"}
            </button>
          </div>

          {calendar.bridge_enabled && calendar.bridge_url && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor={`bridge-url-${calendar.id}`}>Bridge URL (paste into Google)</Label>
                <div className="flex gap-2">
                  <input
                    id={`bridge-url-${calendar.id}`}
                    readOnly
                    value={calendar.bridge_url}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                  />
                  <button
                    type="button"
                    onClick={onCopy}
                    className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <Copy size={14} aria-hidden />
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <button
                    type="button"
                    onClick={onRotate}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <RefreshCw size={14} aria-hidden />
                    {busy === "rotate" ? "…" : "Rotate"}
                  </button>
                </div>
              </div>

              <ol className="ml-5 list-decimal space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                <li>
                  Open{" "}
                  <a
                    href="https://calendar.google.com/calendar/u/0/r/settings/addbyurl"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-indigo-700 underline decoration-indigo-300 hover:decoration-indigo-500 dark:text-indigo-300 dark:decoration-indigo-700"
                  >
                    Google Calendar → Add from URL
                  </a>
                  .
                </li>
                <li>Paste the URL above and click <em>Add calendar</em>.</li>
                <li>
                  Wait up to 24 hours — Google refreshes external calendars
                  slowly. Changes in Outlook won&apos;t appear immediately.
                </li>
              </ol>

              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
                <p>
                  Anyone with this URL can read the calendar — treat it like a
                  password. Use <em>Rotate</em> if you ever paste it somewhere
                  by mistake.
                </p>
              </div>
            </>
          )}

          {error && <p className="text-xs text-red-600 dark:text-red-300">{error}</p>}
        </div>
      )}
    </div>
  );
}

function extractErr(err: unknown, fallback: string): string {
  if (err instanceof CalendarApiError) {
    const fields = err.fields;
    for (const v of Object.values(fields)) {
      if (typeof v === "string") return v;
      if (Array.isArray(v) && typeof v[0] === "string") return v[0];
    }
    return err.message || fallback;
  }
  return err instanceof Error ? err.message : fallback;
}
