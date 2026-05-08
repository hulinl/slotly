"use client";

/**
 * Public availability page — anyone with the link sees this read-only view.
 * Token is in the URL; backend gates on share_enabled and returns 404
 * otherwise. No nav, no auth required, OG tags for nice link previews.
 */

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Globe } from "lucide-react";
import { SlotsCalendar } from "@/components/SlotsCalendar";
import {
  colorFromName,
  computeFreeSlots,
  getInitials,
  getPublicProfile,
  PublicProfileNotFoundError,
  workingHoursRangeFromHours,
  type PublicProfileResponse,
} from "@/lib/public-profile";

export default function PublicProfilePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [data, setData] = useState<PublicProfileResponse | null>(null);
  const [error, setError] = useState<"not_found" | "load" | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await getPublicProfile(token);
        if (alive) setData(r);
      } catch (err) {
        if (!alive) return;
        if (err instanceof PublicProfileNotFoundError) {
          setError("not_found");
        } else {
          setError("load");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const slots = useMemo(() => {
    if (!data) return [];
    const start = new Date(data.window.start);
    const end = new Date(data.window.end);
    const free = computeFreeSlots(data.profile.working_hours, data.busy, start, end);
    return free.map((f) => ({ start: f.start, end: f.end }));
  }, [data]);

  const holidayMap = useMemo(() => {
    if (!data) return new Map<string, string>();
    return new Map(data.holidays.map((h) => [h.date, h.name]));
  }, [data]);

  if (error === "not_found") {
    return (
      <main className="grid min-h-screen place-items-center bg-zinc-50 px-6 dark:bg-zinc-950">
        <div className="mx-auto max-w-md text-center">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            Profile not found
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            This link is invalid or no longer public.
          </p>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="grid min-h-screen place-items-center bg-zinc-50 dark:bg-zinc-950">
        <div className="text-sm text-zinc-500">Loading…</div>
      </main>
    );
  }

  const { display_name, avatar_url, country } = data.profile;
  const initials = getInitials(display_name);
  const bgColor = colorFromName(display_name);

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white py-10 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-3xl items-center gap-5 px-6">
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
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {display_name}
            </h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
              <Globe className="h-4 w-4" />
              <span>{country}</span>
              <span aria-hidden>·</span>
              <span>Availability for the next 8 weeks</span>
            </p>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-8">
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
          />
        )}
      </section>
    </main>
  );
}
