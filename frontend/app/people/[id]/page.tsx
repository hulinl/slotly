"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AuthedHeader } from "@/components/AuthedHeader";
import { BackButton } from "@/components/BackButton";
import { CardSkeleton, PageSkeleton } from "@/components/Skeleton";
import { SlotsCalendar } from "@/components/SlotsCalendar";
import { Button, FormError } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { WEEKDAYS, type Weekday } from "@/lib/me";
import {
  computeFreeSlots,
  getPeerAvailability,
  getTeammateAvailability,
  workingHoursRangeFromHours,
  type PublicProfileResponse,
} from "@/lib/public-profile";
import type { Slot } from "@/lib/search";
import { getTeammate, UsersApiError, type Teammate } from "@/lib/users";

const INTERSECTION_DURATION_MIN = 30;

const DAY_LABEL: Record<Weekday, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

export default function TeammateProfilePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const userId = Number(params.id);

  const [meEmail, setMeEmail] = useState<string | null>(null);
  const [meId, setMeId] = useState<number | null>(null);
  const [user, setUser] = useState<Teammate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [availability, setAvailability] = useState<PublicProfileResponse | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [showIntersection, setShowIntersection] = useState(false);
  const [intersectionSlots, setIntersectionSlots] = useState<Slot[] | null>(null);
  const [intersectionError, setIntersectionError] = useState<string | null>(null);
  const [intersectionLoading, setIntersectionLoading] = useState(false);

  const isMe = meId !== null && meId === userId;

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session.meta?.is_authenticated || !session.data?.user) {
        router.replace("/auth/login");
        return;
      }
      setMeEmail(session.data.user.email);
      setMeId(session.data.user.id);
      try {
        const fetched = await getTeammate(userId);
        setUser(fetched);
      } catch (err) {
        if (err instanceof UsersApiError && err.status === 403) {
          setError("You don't share any team with this user.");
        } else if (err instanceof UsersApiError && err.status === 404) {
          setError("That user doesn't exist.");
        } else {
          setError(err instanceof Error ? err.message : "Could not load profile.");
        }
      }
    })().catch(() => router.replace("/auth/login"));
  }, [userId, router]);

  // Fetch the teammate's own availability — the same view they see on their
  // /profile: working_hours minus their busy, no intersection with the caller.
  // For self-view (isMe), skip; own calendar lives on /profile.
  useEffect(() => {
    if (!user) return;
    if (isMe) {
      setAvailability(null);
      return;
    }
    setSearchError(null);
    getTeammateAvailability(user.id)
      .then(setAvailability)
      .catch((err) =>
        setSearchError(err instanceof Error ? err.message : "Couldn't load availability."),
      );
  }, [user, isMe]);

  const ownSlots = useMemo(() => {
    if (!availability) return [];
    return computeFreeSlots(
      availability.profile.working_hours,
      availability.busy,
      new Date(availability.window.start),
      new Date(availability.window.end),
    );
  }, [availability]);

  const holidays = useMemo(() => {
    if (!availability) return new Map<string, string>();
    return new Map(availability.holidays.map((h) => [h.date, h.name]));
  }, [availability]);

  // Prefetch the intersection view as soon as the peer's own availability
  // has loaded — that way the toggle has instant data and the calendar
  // doesn't briefly flash empty on the first flip.
  useEffect(() => {
    if (!user || isMe || !availability || intersectionSlots !== null) return;
    setIntersectionLoading(true);
    setIntersectionError(null);
    const now = new Date();
    const end = new Date();
    end.setDate(end.getDate() + 56);
    getPeerAvailability(user.id, {
      from: now.toISOString(),
      to: end.toISOString(),
      durationMin: INTERSECTION_DURATION_MIN,
    })
      .then((r) => setIntersectionSlots(r.slots))
      .catch((err) =>
        setIntersectionError(err instanceof Error ? err.message : "Couldn't load shared slots."),
      )
      .finally(() => setIntersectionLoading(false));
  }, [user, isMe, availability, intersectionSlots]);

  const displayedSlots = showIntersection ? intersectionSlots ?? [] : ownSlots;
  const displayedError = showIntersection ? intersectionError : searchError;

  if (!meEmail) {
    return (
      <PageSkeleton>
        <CardSkeleton rows={4} />
      </PageSkeleton>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <AuthedHeader email={meEmail} />
        <main className="mx-auto max-w-2xl space-y-4 px-6 py-10">
          <FormError message={error} />
          <Link href="/groups" className="text-sm text-zinc-600 underline dark:text-zinc-300">
            ← Back to teams
          </Link>
        </main>
      </div>
    );
  }

  if (!user) {
    return (
      <PageSkeleton>
        <CardSkeleton rows={4} />
        <CardSkeleton rows={6} className="mt-6" />
      </PageSkeleton>
    );
  }

  const fullName =
    [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || user.email;
  const initials = (
    (user.first_name || user.email[0] || "?").charAt(0) +
    (user.last_name || user.email[1] || "").charAt(0)
  ).toUpperCase();

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <AuthedHeader email={meEmail} />
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
        <BackButton
          fallback={
            user.shared_team_ids[0]
              ? `/groups/${user.shared_team_ids[0]}`
              : "/people"
          }
        />

        {/* identity card */}
        <section className="flex items-center gap-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xl font-semibold text-white dark:bg-zinc-50 dark:text-zinc-900">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{fullName}</h1>
            <p className="truncate text-sm text-zinc-600 dark:text-zinc-400">{user.email}</p>
            {user.phone && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{user.phone}</p>
            )}
          </div>
        </section>

        {/* teammate's own availability — same shape they see on their /profile.
            Toggle switches to shared-slot search (intersection of the two
            calendars, min 30-min slots) without leaving the page. */}
        {!isMe && (
          <section className="space-y-3">
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                {showIntersection
                  ? user.first_name
                    ? `Times that work for you and ${user.first_name}`
                    : "Times that work for both of you"
                  : user.first_name
                  ? `${user.first_name}'s availability`
                  : "Availability"}
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Next 8 weeks
                {showIntersection ? ` · ${INTERSECTION_DURATION_MIN}-min slots` : ""} · use ‹ › to navigate
              </p>
            </header>
            <label className="flex items-center justify-end gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              <span>Show only times we're both free (min {INTERSECTION_DURATION_MIN} min)</span>
              {intersectionLoading && (
                <span className="text-[10px] text-zinc-400">loading…</span>
              )}
              <button
                type="button"
                role="switch"
                aria-checked={showIntersection}
                onClick={() => setShowIntersection((v) => !v)}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-950 ${
                  showIntersection
                    ? "bg-indigo-600"
                    : "bg-zinc-300 dark:bg-zinc-700"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    showIntersection ? "translate-x-[18px]" : "translate-x-0.5"
                  }`}
                />
              </button>
            </label>
            {displayedError && <FormError message={displayedError} />}
            {!availability ? (
              <CardSkeleton rows={6} />
            ) : (
              <SlotsCalendar
                slots={displayedSlots}
                durationMin={showIntersection ? INTERSECTION_DURATION_MIN : 30}
                holidays={holidays}
                workingHoursRange={workingHoursRangeFromHours(user.working_hours)}
                stickyView
              />
            )}
            <div className="flex justify-end">
              <Link href="/search">
                <Button variant="secondary" className="sm:w-auto sm:px-4">
                  Open full search
                </Button>
              </Link>
            </div>
          </section>
        )}

        {/* working hours — context after the calendar */}
        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-3 text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Working hours
          </h2>
          <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {WEEKDAYS.map((day) => {
              const row = user.working_hours[day];
              return (
                <li key={day} className="flex items-center justify-between border-b border-zinc-100 py-1.5 last:border-b-0 dark:border-zinc-800">
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">{DAY_LABEL[day]}</span>
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {row.available ? `${row.start} – ${row.end}` : <em className="text-zinc-400">unavailable</em>}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </main>
    </div>
  );
}

