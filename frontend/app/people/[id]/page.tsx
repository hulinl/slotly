"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthedHeader } from "@/components/AuthedHeader";
import { BackButton } from "@/components/BackButton";
import { CardSkeleton, PageSkeleton } from "@/components/Skeleton";
import { SlotsCalendar } from "@/components/SlotsCalendar";
import { Button, FormError } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { WEEKDAYS, type Weekday } from "@/lib/me";
import { getPeerAvailability, workingHoursRangeFromHours } from "@/lib/public-profile";
import { fetchHolidaysForRange } from "@/lib/holidays";
import type { Slot } from "@/lib/search";
import { getTeammate, UsersApiError, type Teammate } from "@/lib/users";

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

  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const [holidays, setHolidays] = useState<Map<string, string>>(new Map());

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

  // Once we have the teammate, fetch 8 weeks of slots that work for *both*
  // of us — the intersection of caller + target free time within their
  // joint working hours. For self-view (isMe), skip; the calendar there is
  // about the caller's own free time and lives on /profile.
  useEffect(() => {
    if (!user) return;
    if (isMe) {
      setSlots([]);
      return;
    }
    setSearching(true);
    setSearchError(null);
    const now = new Date();
    const end = new Date();
    end.setDate(end.getDate() + 56);
    getPeerAvailability(user.id, {
      from: now.toISOString(),
      to: end.toISOString(),
      durationMin: 60,
    })
      .then((r) => setSlots(r.slots))
      .catch((err) =>
        setSearchError(err instanceof Error ? err.message : "Couldn't load availability."),
      )
      .finally(() => setSearching(false));

    // Holidays for the visible range, in the teammate's country (since the
    // page is mostly about their schedule).
    fetchHolidaysForRange(now.toISOString(), end.toISOString(), user.country)
      .then(setHolidays)
      .catch(() => setHolidays(new Map()));
  }, [user, isMe]);

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
          <Link href="/settings/teams" className="text-sm text-zinc-600 underline dark:text-zinc-300">
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
              ? `/settings/teams/${user.shared_team_ids[0]}`
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

        {/* shared availability — intersection of caller + target */}
        {!isMe && (
          <section className="space-y-3">
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                {user.first_name
                  ? `Times that work for you and ${user.first_name}`
                  : "Times that work for both of you"}
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Next 8 weeks · 60-min slots · use ‹ › to navigate
              </p>
            </header>
            {searchError && <FormError message={searchError} />}
            {searching && !slots ? (
              <CardSkeleton rows={6} />
            ) : slots && slots.length > 0 ? (
              <SlotsCalendar
                slots={slots}
                durationMin={60}
                holidays={holidays}
                workingHoursRange={user ? workingHoursRangeFromHours(user.working_hours) : undefined}
              />
            ) : (
              <section className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
                No 1-hour slot when both of you are free over the next 8 weeks.
              </section>
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

