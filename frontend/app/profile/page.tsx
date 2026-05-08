"use client";

/**
 * /profile — own availability overview. Mirrors the public /u/<token> page
 * for self-preview, plus inline Unavailability management. Self-only — no
 * token, behind login.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarOff, ExternalLink, Globe, Settings as SettingsIcon, Trash2 } from "lucide-react";
import { AuthedHeader } from "@/components/AuthedHeader";
import { DatePicker } from "@/components/DatePicker";
import { CardSkeleton, PageSkeleton } from "@/components/Skeleton";
import { SlotsCalendar } from "@/components/SlotsCalendar";
import { Button, FormError, FormSuccess, Input, Label } from "@/components/ui";
import { getSession } from "@/lib/auth";
import {
  createUnavailability,
  deleteUnavailability,
  listUnavailabilities,
  UnavailabilityApiError,
  type Unavailability,
} from "@/lib/availability";
import { getMe, type Me } from "@/lib/me";
import {
  colorFromName,
  computeFreeSlots,
  getInitials,
  workingHoursRangeFromHours,
  type PublicProfileResponse,
} from "@/lib/public-profile";

async function getMyAvailability(): Promise<PublicProfileResponse> {
  const res = await fetch("/api/me/availability", { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export default function ProfilePage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [meId, setMeId] = useState<number | null>(null);
  const [data, setData] = useState<PublicProfileResponse | null>(null);
  const [unavailabilities, setUnavailabilities] = useState<Unavailability[] | null>(null);
  const [adding, setAdding] = useState(false);

  async function refreshUnavailabilities(uid: number) {
    try {
      setUnavailabilities(await listUnavailabilities(uid));
    } catch {
      setUnavailabilities([]);
    }
  }

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session.meta?.is_authenticated || !session.data?.user) {
        router.replace("/auth/login?next=/profile");
        return;
      }
      setMeId(session.data.user.id);
      const [meData, availData] = await Promise.all([getMe(), getMyAvailability()]);
      setMe(meData);
      setData(availData);
      refreshUnavailabilities(session.data.user.id);
    })().catch(() => router.replace("/auth/login"));
  }, [router]);

  const slots = useMemo(() => {
    if (!data) return [];
    const start = new Date(data.window.start);
    const end = new Date(data.window.end);
    return computeFreeSlots(data.profile.working_hours, data.busy, start, end);
  }, [data]);

  const holidayMap = useMemo(() => {
    if (!data) return new Map<string, string>();
    return new Map(data.holidays.map((h) => [h.date, h.name]));
  }, [data]);

  if (!me || !data || meId === null) {
    return (
      <PageSkeleton>
        <CardSkeleton rows={3} />
        <CardSkeleton rows={6} className="mt-6" />
      </PageSkeleton>
    );
  }

  const { display_name, avatar_url, country } = data.profile;
  const initials = getInitials(display_name);
  const bgColor = colorFromName(display_name);
  const publicUrl =
    typeof window !== "undefined" && me.share_token && me.share_enabled
      ? `${window.location.origin}/u/${me.share_token}`
      : "";

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <AuthedHeader email={me.email} />
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
        {/* Header card — same layout the public page uses */}
        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center gap-5">
            {avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatar_url}
                alt={display_name}
                className="h-20 w-20 shrink-0 rounded-full object-cover ring-2 ring-zinc-200 dark:ring-zinc-700"
              />
            ) : (
              <div
                className="grid h-20 w-20 shrink-0 place-items-center rounded-full text-2xl font-semibold text-white ring-2 ring-zinc-200 dark:ring-zinc-700"
                style={{ backgroundColor: bgColor }}
                aria-hidden
              >
                {initials}
              </div>
            )}
            <div className="flex-1 min-w-[12rem]">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                {display_name}
              </h1>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                <Globe className="h-4 w-4" />
                <span>{country}</span>
                <span aria-hidden>·</span>
                <span>{me.email}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/settings?from=profile"
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <SettingsIcon className="h-4 w-4" />
                Settings
              </Link>
              {publicUrl && (
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200 dark:hover:bg-indigo-950/60"
                >
                  <ExternalLink className="h-4 w-4" />
                  View public link
                </a>
              )}
            </div>
          </div>
          <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
            This is what people see on your public link. Toggle sharing in
            <Link href="/settings?from=profile" className="font-medium underline">
              {" "}
              Settings
            </Link>
            .
          </p>
        </section>

        {/* Availability calendar with inline unavailability blocks */}
        <section className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Your availability — next 8 weeks
            </h2>
            <Button
              onClick={() => setAdding(true)}
              className="inline-flex items-center justify-center gap-2 sm:!w-auto sm:px-4"
            >
              <CalendarOff size={16} aria-hidden />
              <span>Add unavailability</span>
            </Button>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Green = free. Amber = blocks you marked unavailable (tap the trash icon to delete).
          </p>
          {slots.length === 0 ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              No free time in the upcoming weeks.
            </div>
          ) : (
            <SlotsCalendar
              slots={slots}
              durationMin={30}
              holidays={holidayMap}
              workingHoursRange={workingHoursRangeFromHours(data.profile.working_hours)}
              unavailabilityBlocks={unavailabilities ?? []}
              onDeleteUnavailability={async (id) => {
                try {
                  await deleteUnavailability(id);
                  await refreshUnavailabilities(meId);
                } catch (err) {
                  alert(err instanceof Error ? err.message : "Delete failed");
                }
              }}
            />
          )}
        </section>

        {/* Full list of upcoming blocks — including ones outside the visible
            calendar range so the user has the complete picture. */}
        <UpcomingUnavailabilityList
          rows={unavailabilities}
          onDeleted={() => refreshUnavailabilities(meId)}
        />
      </main>

      {adding && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4"
          role="dialog"
          aria-modal
          onClick={(e) => {
            // Close when the backdrop itself is clicked.
            if (e.target === e.currentTarget) setAdding(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <h3 className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Add unavailability
            </h3>
            <AddUnavailabilityForm
              onCancel={() => setAdding(false)}
              onSaved={async () => {
                setAdding(false);
                await refreshUnavailabilities(meId);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upcoming unavailability — full list (including blocks far in the future
// that aren't visible in the calendar's 8-week view) so the user always
// has the complete picture.
// ---------------------------------------------------------------------------

function UpcomingUnavailabilityList({
  rows,
  onDeleted,
}: {
  rows: Unavailability[] | null;
  onDeleted: () => void | Promise<void>;
}) {
  const now = Date.now();
  const upcoming = (rows ?? [])
    .filter((u) => new Date(u.ends_at).getTime() >= now)
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  const past = (rows ?? [])
    .filter((u) => new Date(u.ends_at).getTime() < now)
    .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());

  if (upcoming.length === 0 && past.length === 0) return null;

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {upcoming.length > 0 && (
        <>
          <h2 className="mb-1 text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Upcoming unavailability
          </h2>
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            All blocks you have planned, including ones outside the visible calendar.
          </p>
          <UnavailabilityList rows={upcoming} onDeleted={onDeleted} />
        </>
      )}
      {past.length > 0 && (
        <details className={"group/past " + (upcoming.length > 0 ? "mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-800" : "")}>
          <summary className="cursor-pointer text-sm font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100">
            Past blocks <span className="text-xs text-zinc-400">({past.length})</span>
          </summary>
          <p className="mt-1 mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            Already-finished blocks. They no longer affect availability searches.
          </p>
          <UnavailabilityList rows={past} onDeleted={onDeleted} muted />
        </details>
      )}
    </section>
  );
}

function UnavailabilityList({
  rows,
  onDeleted,
  muted = false,
}: {
  rows: Unavailability[];
  onDeleted: () => void | Promise<void>;
  muted?: boolean;
}) {
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {rows.map((u) => (
        <li key={u.id} className="flex items-start gap-3 py-3">
          <div className="flex-1">
            <p
              className={
                "text-sm font-medium " +
                (muted
                  ? "text-zinc-500 dark:text-zinc-400"
                  : "text-zinc-900 dark:text-zinc-50")
              }
            >
              {u.label}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {formatRange(u.starts_at, u.ends_at, u.is_all_day)}
            </p>
          </div>
          <button
            type="button"
            onClick={async () => {
              if (!confirm(`Delete "${u.label}"?`)) return;
              try {
                await deleteUnavailability(u.id);
                await onDeleted();
              } catch (err) {
                alert(err instanceof Error ? err.message : "Delete failed");
              }
            }}
            aria-label={`Delete "${u.label}"`}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-red-600 transition-colors hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30"
          >
            <Trash2 size={14} aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

function AddUnavailabilityForm({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const today = toLocalDateString(new Date());
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!label.trim()) {
      setError("Give the block a label.");
      return;
    }
    if (!startDate || !endDate) {
      setError("Pick both start and end dates.");
      return;
    }
    if (new Date(`${endDate}T00:00:00`) < new Date(`${startDate}T00:00:00`)) {
      setError("End must be on or after start.");
      return;
    }
    setSubmitting(true);
    try {
      const startISO = new Date(`${startDate}T00:00:00`).toISOString();
      const endLocal = new Date(`${endDate}T00:00:00`);
      endLocal.setDate(endLocal.getDate() + 1);
      const endISO = endLocal.toISOString();
      await createUnavailability({
        label: label.trim(),
        starts_at: startISO,
        ends_at: endISO,
        is_all_day: true,
      });
      setSuccess("Saved.");
      setLabel("");
      setStartDate(today);
      setEndDate(today);
      await onSaved();
    } catch (err) {
      setError(err instanceof UnavailabilityApiError ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mb-4 space-y-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="space-y-1.5">
        <Label htmlFor="block-label">Label</Label>
        <Input
          id="block-label"
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Vacation, Sick, Off-site…"
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="block-start">From</Label>
          <DatePicker
            id="block-start"
            value={startDate}
            onChange={(v) => {
              setStartDate(v);
              // Snap end-date forward when the user pushes the start past it,
              // and also follow when start equals end (so picking a future
              // start automatically picks the same day end). Lets the user
              // override afterwards.
              if (!endDate || v > endDate || endDate === startDate) {
                setEndDate(v);
              }
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="block-end">Until (inclusive)</Label>
          <DatePicker id="block-end" value={endDate} onChange={setEndDate} min={startDate} />
        </div>
      </div>
      <FormError message={error} />
      <FormSuccess message={success} />
      <div className="flex gap-2">
        <Button type="submit" disabled={submitting} className="sm:w-auto sm:px-4">
          {submitting ? "Saving…" : "Save block"}
        </Button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function formatRange(startISO: string, endISO: string, isAllDay: boolean): string {
  const start = new Date(startISO);
  const endExclusive = new Date(endISO);
  const endInclusive = isAllDay
    ? new Date(endExclusive.getTime() - 1)
    : endExclusive;
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  if (isAllDay && start.toDateString() === endInclusive.toDateString()) {
    return `${fmt(start)} (all day)`;
  }
  if (isAllDay) {
    return `${fmt(start)} – ${fmt(endInclusive)}`;
  }
  const fmtTime = (d: Date) =>
    d.toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  return `${fmtTime(start)} – ${fmtTime(endExclusive)}`;
}

function toLocalDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
