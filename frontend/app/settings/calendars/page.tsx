"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AuthedHeader } from "@/components/AuthedHeader";
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
  syncCalendar,
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

      <main className="mx-auto max-w-2xl space-y-8 px-6 py-10">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-zinc-500">
            <Link href="/settings" className="underline">Settings</Link> / Calendars
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Calendar subscriptions
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Slotly reads only free/busy times — never event titles, descriptions, or attendees.
            Polling cadence: every 5 minutes.
          </p>
        </div>

        <AddCalendarForm
          onAdded={(cal) => setCalendars((prev) => [cal, ...prev.filter((c) => c.id !== cal.id)])}
        />

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
      const synced = created.sync;
      if (synced && synced.status_code >= 400) {
        setError(`Saved, but the URL returned HTTP ${synced.status_code}. Slotly will keep retrying.`);
      } else if (synced) {
        setSuccess(
          `Connected. Synced ${synced.written} event${synced.written === 1 ? "" : "s"} from the next 3 months.`,
        );
      }
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
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            <ProviderHelp />
          </p>
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

function ProviderHelp() {
  return (
    <span>
      <strong>Google:</strong> Settings → calendar → &ldquo;Secret address in iCal format&rdquo;.{" "}
      <strong>Apple:</strong> share calendar publicly and copy the URL.{" "}
      <strong>Outlook:</strong> Calendar → Sharing → Publish calendar → ICS link.
    </span>
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
      <div className="flex items-start justify-between gap-4">
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
    </article>
  );
}
