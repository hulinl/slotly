"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { AuthedHeader } from "@/components/AuthedHeader";
import { DatePicker } from "@/components/DatePicker";
import { CardSkeleton, PageSkeleton } from "@/components/Skeleton";
import { SlotsCalendar } from "@/components/SlotsCalendar";
import { Button, FormError, FormSuccess, Input, Label } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { fetchHolidaysForRange } from "@/lib/holidays";
import { getMe } from "@/lib/me";
import { searchSlots, SearchApiError, type Slot } from "@/lib/search";
import {
  createSavedSearch,
  deleteSavedSearch,
  listRecentSearches,
  listSavedSearches,
  SavedSearchApiError,
  type RecentSearch,
  type SavedSearch,
} from "@/lib/saved-searches";
import { getTeam, listTeams, type TeamDetail, type TeamSummary } from "@/lib/teams";

const DURATION_PRESETS = [15, 30, 45, 60, 90, 120, 240, 480];

type FormSeed = {
  teamId: number;
  selectedIds: number[] | null; // null = "default to whole team"
  duration: number;
  buffer: number;
  startDate: string; // YYYY-MM-DD (local)
  endDate: string;
};

function defaultSeed(teamId: number): FormSeed {
  return {
    teamId,
    selectedIds: null,
    duration: 60,
    buffer: 0,
    startDate: toLocalDate(new Date()),
    endDate: toLocalDate(addDays(new Date(), 90)),
  };
}

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchPageInner />
    </Suspense>
  );
}

function SearchPageInner() {
  const router = useRouter();
  const queryParams = useSearchParams();
  const requestedSavedId = queryParams.get("saved");
  const [email, setEmail] = useState("");
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [seed, setSeed] = useState<FormSeed | null>(null);
  const [seedKey, setSeedKey] = useState(0);

  const [country, setCountry] = useState<string>("CZ");

  async function refreshPresets() {
    const [s, r] = await Promise.all([listSavedSearches(), listRecentSearches()]);
    setSavedSearches(s);
    setRecentSearches(r);
  }

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session.meta?.is_authenticated || !session.data?.user) {
        router.replace("/auth/login");
        return;
      }
      setEmail(session.data.user.email);
      const [fetchedTeams, me] = await Promise.all([listTeams(), getMe().catch(() => null)]);
      setTeams(fetchedTeams);
      if (me?.country) setCountry(me.country);
      if (fetchedTeams.length > 0) {
        const [savedList, recentList] = await Promise.all([
          listSavedSearches(),
          listRecentSearches(),
        ]);
        setSavedSearches(savedList);
        setRecentSearches(recentList);

        // If we got here via /search?saved=<id>, prefill from that saved search.
        const requested =
          requestedSavedId !== null
            ? savedList.find((s) => String(s.id) === requestedSavedId)
            : undefined;
        if (requested) {
          setSeed({
            teamId: requested.team,
            selectedIds: requested.member_ids,
            duration: requested.duration_min,
            buffer: requested.buffer_min,
            startDate: toLocalDate(new Date()),
            endDate: toLocalDate(addDays(new Date(), requested.window_days)),
          });
        } else {
          setSeed(defaultSeed(fetchedTeams[0].id));
        }
      }
      setLoaded(true);
    })().catch(() => router.replace("/auth/login"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  if (!loaded) {
    return (
      <PageSkeleton>
        <CardSkeleton rows={6} />
      </PageSkeleton>
    );
  }

  function applySeed(next: FormSeed) {
    setSeed(next);
    setSeedKey((k) => k + 1);
  }

  function loadSaved(s: SavedSearch) {
    applySeed({
      teamId: s.team,
      selectedIds: s.member_ids,
      duration: s.duration_min,
      buffer: s.buffer_min,
      startDate: toLocalDate(new Date()),
      endDate: toLocalDate(addDays(new Date(), s.window_days)),
    });
  }

  function loadRecent(r: RecentSearch) {
    applySeed({
      teamId: r.team,
      selectedIds: r.member_ids,
      duration: r.duration_min,
      buffer: r.buffer_min,
      startDate: toLocalDate(new Date(r.window_start)),
      endDate: toLocalDate(new Date(r.window_end)),
    });
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <AuthedHeader email={email} />

      <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Find a time to meet
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Pick a team and the people you need; Slotly returns every shared free slot in your search window.
          </p>
        </div>

        {teams.length === 0 ? (
          <EmptyTeamsCard />
        ) : (
          <>
            {(savedSearches.length > 0 || recentSearches.length > 0) && (
              <PresetsPanel
                teams={teams}
                saved={savedSearches}
                recent={recentSearches}
                onLoadSaved={loadSaved}
                onLoadRecent={loadRecent}
                onChanged={refreshPresets}
              />
            )}
            {seed && (
              <SearchForm
                key={seedKey}
                teams={teams}
                initialSeed={seed}
                onSearched={refreshPresets}
                savedSearches={savedSearches}
                country={country}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function EmptyTeamsCard() {
  return (
    <section className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
      You aren&apos;t in any teams yet.{" "}
      <Link href="/settings/teams" className="font-medium text-zinc-900 underline dark:text-zinc-50">
        Create one
      </Link>{" "}
      to start searching.
    </section>
  );
}

// ---------------------------------------------------------------------------
// Presets (saved + recent)
// ---------------------------------------------------------------------------

function PresetsPanel({
  teams,
  saved,
  recent,
  onLoadSaved,
  onLoadRecent,
  onChanged,
}: {
  teams: TeamSummary[];
  saved: SavedSearch[];
  recent: RecentSearch[];
  onLoadSaved: (s: SavedSearch) => void;
  onLoadRecent: (r: RecentSearch) => void;
  onChanged: () => void;
}) {
  const teamName = (id: number) => teams.find((t) => t.id === id)?.name ?? `Team #${id}`;

  async function onDeleteSaved(s: SavedSearch) {
    if (!confirm(`Delete saved search "${s.name}"?`)) return;
    await deleteSavedSearch(s.id);
    await onChanged();
  }

  return (
    <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {saved.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Saved searches
          </h2>
          <ul className="flex flex-wrap gap-2">
            {saved.map((s) => (
              <li key={s.id} className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800">
                <button
                  type="button"
                  onClick={() => onLoadSaved(s)}
                  className="font-medium text-zinc-800 hover:underline dark:text-zinc-100"
                  title={`${teamName(s.team)} • ${s.member_ids.length} members • ${s.duration_min}min • next ${s.window_days}d`}
                >
                  {s.name}
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteSaved(s)}
                  aria-label={`Delete saved search ${s.name}`}
                  className="text-zinc-400 hover:text-red-600"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {recent.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Recent
          </h2>
          <ul className="space-y-1">
            {recent.slice(0, 5).map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => onLoadRecent(r)}
                  className="flex-1 truncate text-left text-zinc-700 hover:underline dark:text-zinc-300"
                >
                  <strong>{teamName(r.team)}</strong> • {r.member_ids.length} member{r.member_ids.length === 1 ? "" : "s"} •{" "}
                  {r.duration_min}min • {new Date(r.window_start).toLocaleDateString()}–
                  {new Date(r.window_end).toLocaleDateString()}
                </button>
                <span className="shrink-0 text-zinc-400">{relativeTime(r.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Search form
// ---------------------------------------------------------------------------

function SearchForm({
  teams,
  initialSeed,
  onSearched,
  savedSearches,
  country,
}: {
  teams: TeamSummary[];
  initialSeed: FormSeed;
  onSearched: () => void;
  savedSearches: SavedSearch[];
  country: string;
}) {
  const [teamId, setTeamId] = useState<number>(initialSeed.teamId);
  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [selected, setSelected] = useState<Set<number>>(
    new Set(initialSeed.selectedIds ?? []),
  );
  const [duration, setDuration] = useState(initialSeed.duration);
  const [buffer, setBuffer] = useState(initialSeed.buffer);
  const [start, setStart] = useState<string>(initialSeed.startDate);
  const [end, setEnd] = useState<string>(initialSeed.endDate);

  // Whether the user has manually edited "Until" since the last "From" change.
  // While untouched, changing "From" auto-bumps "Until" to From + 3 months.
  const [endTouched, setEndTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ slots: Slot[]; truncated: boolean } | null>(null);
  const [holidays, setHolidays] = useState<Map<string, string>>(new Map());

  // Load team detail (member roster) whenever the team changes. If no
  // explicit selection seed was provided (e.g. user just opened the page),
  // default to "everyone in the team".
  useEffect(() => {
    setTeam(null);
    let cancelled = false;
    getTeam(teamId).then((t) => {
      if (cancelled) return;
      setTeam(t);
      if (initialSeed.selectedIds === null && teamId === initialSeed.teamId) {
        setSelected(new Set(t.members.map((m) => m.user_id)));
      }
    });
    return () => {
      cancelled = true;
    };
    // initialSeed is stable for this form instance (key remounts on preset load).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  const memberCount = team?.members.length ?? 0;
  const allSelected = team !== null && selected.size === memberCount && memberCount > 0;

  function toggleMember(userId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (selected.size === 0) {
      setError("Pick at least one teammate.");
      return;
    }
    setSubmitting(true);
    try {
      // Date-only inputs: search from local 00:00 of "From" until 23:59:59.999
      // of "Until" so the entire "Until" day is included.
      const winStart = new Date(`${start}T00:00:00.000`);
      const winEnd = new Date(`${end}T23:59:59.999`);
      if (winEnd <= winStart) {
        setError("“Until” must be on or after “From”.");
        setSubmitting(false);
        return;
      }
      const r = await searchSlots({
        team_id: teamId,
        member_ids: Array.from(selected),
        duration_min: duration,
        buffer_min: buffer,
        window_start: winStart.toISOString(),
        window_end: winEnd.toISOString(),
      });
      setResult({ slots: r.slots, truncated: r.truncated });
      onSearched();
      // Fetch holidays for the search range so the calendar grid can mark them.
      fetchHolidaysForRange(winStart.toISOString(), winEnd.toISOString(), country)
        .then(setHolidays)
        .catch(() => setHolidays(new Map()));
    } catch (err) {
      setError(err instanceof SearchApiError ? err.message : "Search failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <form
        onSubmit={onSubmit}
        className="space-y-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="space-y-1.5">
          <Label htmlFor="team">Team</Label>
          <select
            id="team"
            value={teamId}
            onChange={(e) => setTeamId(Number(e.target.value))}
            className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-950"
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>
              Members ({selected.size}/{memberCount})
            </Label>
            {team && (
              <button
                type="button"
                onClick={() =>
                  setSelected(allSelected ? new Set() : new Set(team.members.map((m) => m.user_id)))
                }
                className="text-xs text-zinc-600 underline dark:text-zinc-300"
              >
                {allSelected ? "Clear" : "Select all"}
              </button>
            )}
          </div>
          {team === null ? (
            <p className="text-sm text-zinc-500">Loading members…</p>
          ) : (
            <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {team.members.map((m) => (
                <li key={m.user_id} className="flex items-center gap-3 px-3 py-2">
                  <input
                    type="checkbox"
                    id={`m-${m.user_id}`}
                    checked={selected.has(m.user_id)}
                    onChange={() => toggleMember(m.user_id)}
                    className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <label htmlFor={`m-${m.user_id}`} className="flex-1 cursor-pointer text-sm">
                    {m.first_name || m.last_name
                      ? `${m.first_name} ${m.last_name}`.trim()
                      : m.email}
                  </label>
                  <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                    {m.role}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="duration">Meeting duration (minutes)</Label>
            <select
              id="duration"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-950"
            >
              {DURATION_PRESETS.map((d) => (
                <option key={d} value={d}>
                  {d < 60 ? `${d} min` : `${d / 60} h`}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="buffer">Buffer between meetings (minutes)</Label>
            <select
              id="buffer"
              value={buffer}
              onChange={(e) => setBuffer(Number(e.target.value))}
              className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-950"
            >
              {[0, 5, 10, 15, 30].map((b) => (
                <option key={b} value={b}>
                  {b === 0 ? "None" : `${b} min`}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="start">From</Label>
            <DatePicker
              id="start"
              value={start}
              onChange={(next) => {
                setStart(next);
                if (!endTouched && next) {
                  // Auto-shift the "Until" default to From + 3 months until
                  // the user manually edits it.
                  setEnd(toLocalDate(addDays(new Date(`${next}T00:00:00`), 90)));
                }
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="end">Until</Label>
            <DatePicker
              id="end"
              value={end}
              min={start}
              onChange={(next) => {
                setEnd(next);
                setEndTouched(true);
              }}
            />
          </div>
        </div>

        <FormError message={error} />
        <Button type="submit" disabled={submitting} className="sm:w-auto sm:px-6">
          {submitting ? "Searching…" : "Find slots"}
        </Button>
      </form>

      {result && (
        <>
          <Results slots={result.slots} truncated={result.truncated} durationMin={duration} holidays={holidays} />
          <SaveCurrentSearch
            teamId={teamId}
            memberIds={Array.from(selected)}
            duration={duration}
            buffer={buffer}
            startDate={start}
            endDate={end}
            existingNames={new Set(savedSearches.map((s) => s.name))}
            onSaved={onSearched}
          />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Save-this-search inline panel
// ---------------------------------------------------------------------------

function SaveCurrentSearch({
  teamId,
  memberIds,
  duration,
  buffer,
  startDate,
  endDate,
  existingNames,
  onSaved,
}: {
  teamId: number;
  memberIds: number[];
  duration: number;
  buffer: number;
  startDate: string;
  endDate: string;
  existingNames: Set<string>;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Days between today (start of day) and the chosen "Until" — we save the
  // saved-search as a relative window from the date the user re-loads it.
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const endMidnight = new Date(`${endDate}T00:00:00`);
  const windowDays = Math.max(
    1,
    Math.round((endMidnight.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24)),
  );

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give it a name.");
      return;
    }
    if (existingNames.has(trimmed)) {
      setError("You already have a saved search with this name.");
      return;
    }
    setSubmitting(true);
    try {
      await createSavedSearch({
        name: trimmed,
        team: teamId,
        member_ids: memberIds,
        duration_min: duration,
        buffer_min: buffer,
        window_days: windowDays,
      });
      setSuccess(`Saved as “${trimmed}”.`);
      setName("");
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(err instanceof SavedSearchApiError ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  void startDate; // displayed only via the relative windowDays

  if (!open) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-5 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Like this search? Save it and re-run it in one click.
        </p>
        <FormSuccess message={success} />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Save this search
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <Label htmlFor="save-name">Save as</Label>
      <Input
        id="save-name"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Devs weekly"
      />
      <FormError message={error} />
      <p className="text-xs text-zinc-500">
        Will be saved with a relative window of <strong>{windowDays} day{windowDays === 1 ? "" : "s"}</strong> from when you load it.
      </p>
      <div className="flex gap-2">
        <Button type="submit" disabled={submitting} className="sm:w-auto sm:px-4">
          {submitting ? "Saving…" : "Save"}
        </Button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------

function Results({
  slots,
  truncated,
  durationMin,
  holidays,
}: {
  slots: Slot[];
  truncated: boolean;
  durationMin: number;
  holidays: Map<string, string>;
}) {
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const grouped = useMemo(() => groupByDay(slots), [slots]);

  if (slots.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
        No shared slots in that window. Try a longer window, smaller duration, or fewer members.
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Found {slots.length} slot{slots.length === 1 ? "" : "s"}
          </h2>
          {truncated && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              More available — narrow your search
            </span>
          )}
        </div>
        <div
          role="tablist"
          aria-label="Result view"
          className="inline-flex rounded-md border border-zinc-200 bg-white text-xs font-medium dark:border-zinc-800 dark:bg-zinc-900"
        >
          <button
            type="button"
            role="tab"
            aria-selected={view === "calendar"}
            onClick={() => setView("calendar")}
            className={
              "rounded-l-md px-3 py-1.5 " +
              (view === "calendar"
                ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800")
            }
          >
            Calendar
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "list"}
            onClick={() => setView("list")}
            className={
              "rounded-r-md px-3 py-1.5 " +
              (view === "list"
                ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800")
            }
          >
            List
          </button>
        </div>
      </header>

      {view === "calendar" ? (
        <SlotsCalendar slots={slots} durationMin={durationMin} holidays={holidays} />
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="space-y-4">
            {grouped.map(([day, daySlots]) => (
              <div key={day}>
                <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">{day}</h3>
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                  {daySlots.map((s) => (
                    <li
                      key={s.start}
                      className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
                    >
                      <span className="flex-1 font-medium">{formatTimeRange(s)}</span>
                      <button
                        onClick={() => copyToClipboard(`${day}, ${formatTimeRange(s)}`)}
                        className="text-xs text-zinc-500 underline dark:text-zinc-400"
                        type="button"
                      >
                        Copy
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toLocalDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function formatTimeRange(s: Slot): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${fmt(s.start)} – ${fmt(s.end)}`;
}

function groupByDay(slots: Slot[]): Array<[string, Slot[]]> {
  const buckets = new Map<string, Slot[]>();
  for (const s of slots) {
    const day = new Date(s.start).toLocaleDateString([], {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    if (!buckets.has(day)) buckets.set(day, []);
    buckets.get(day)!.push(s);
  }
  return Array.from(buckets.entries());
}

function copyToClipboard(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {
    /* ignore */
  });
}

function relativeTime(iso: string): string {
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
