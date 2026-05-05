"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AuthedHeader } from "@/components/AuthedHeader";
import { CardSkeleton, PageSkeleton } from "@/components/Skeleton";
import { SlotsCalendar } from "@/components/SlotsCalendar";
import { Button, FormError } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { WEEKDAYS, type Weekday } from "@/lib/me";
import { searchSlots, type Slot } from "@/lib/search";
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
  const [user, setUser] = useState<Teammate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session.meta?.is_authenticated || !session.data?.user) {
        router.replace("/auth/login");
        return;
      }
      setMeEmail(session.data.user.email);
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

  // Once we have the teammate, fetch the next 14 days of free slots in any
  // shared team.
  useEffect(() => {
    if (!user || user.shared_team_ids.length === 0) return;
    setSearching(true);
    setSearchError(null);
    const teamId = user.shared_team_ids[0];
    const now = new Date();
    const end = new Date();
    end.setDate(end.getDate() + 14);
    searchSlots({
      team_id: teamId,
      member_ids: [user.id],
      duration_min: 60,
      window_start: now.toISOString(),
      window_end: end.toISOString(),
    })
      .then((r) => setSlots(r.slots))
      .catch((err) =>
        setSearchError(err instanceof Error ? err.message : "Couldn't load availability."),
      )
      .finally(() => setSearching(false));
  }, [user]);

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
        <Link
          href={
            user.shared_team_ids[0]
              ? `/settings/teams/${user.shared_team_ids[0]}`
              : "/settings/teams"
          }
          className="text-xs text-zinc-500 hover:underline dark:text-zinc-400"
        >
          ← Back to team
        </Link>

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

        {/* working hours */}
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

        {/* availability — next 14 days */}
        <section className="space-y-3">
          <header className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              When {user.first_name || "they"} {user.first_name ? "is" : "are"} free
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Next 14 days · 60-min slots</p>
          </header>
          {searchError && <FormError message={searchError} />}
          {searching && !slots ? (
            <CardSkeleton rows={6} />
          ) : slots && slots.length > 0 ? (
            <SlotsCalendar slots={slots} durationMin={60} />
          ) : (
            <section className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
              {user.shared_team_ids.length === 0
                ? "You don't share a team with this user, so we can't compute availability."
                : "No 1-hour slots in their working hours over the next 14 days."}
            </section>
          )}
          <div className="flex justify-end">
            <Link
              href={
                user.shared_team_ids[0]
                  ? `/search`
                  : "/search"
              }
            >
              <Button variant="secondary" className="sm:w-auto sm:px-4">
                Open full search
              </Button>
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
