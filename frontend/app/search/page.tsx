"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AuthedHeader } from "@/components/AuthedHeader";
import { Button, FormError, Input, Label } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { searchSlots, SearchApiError, type Slot } from "@/lib/search";
import { getTeam, listTeams, type TeamDetail, type TeamSummary } from "@/lib/teams";

const DURATION_PRESETS = [15, 30, 45, 60, 90, 120, 240, 480];

export default function SearchPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session.meta?.is_authenticated || !session.data?.user) {
        router.replace("/auth/login");
        return;
      }
      setEmail(session.data.user.email);
      setTeams(await listTeams());
      setLoaded(true);
    })().catch(() => router.replace("/auth/login"));
  }, [router]);

  if (!loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <p className="text-sm text-zinc-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <AuthedHeader email={email} />

      <main className="mx-auto max-w-3xl space-y-8 px-6 py-10">
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
          <SearchForm teams={teams} />
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

function SearchForm({ teams }: { teams: TeamSummary[] }) {
  const [teamId, setTeamId] = useState<number>(teams[0].id);
  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [duration, setDuration] = useState(60);
  const [buffer, setBuffer] = useState(0);
  const [start, setStart] = useState<string>(() => toLocalIso(new Date()));
  const [end, setEnd] = useState<string>(() => toLocalIso(addDays(new Date(), 90)));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ slots: Slot[]; truncated: boolean } | null>(null);

  // Load team detail (member roster) whenever the team changes.
  useEffect(() => {
    setTeam(null);
    setSelected(new Set());
    getTeam(teamId).then((t) => {
      setTeam(t);
      // Default selection = everyone in the team.
      setSelected(new Set(t.members.map((m) => m.user_id)));
    });
  }, [teamId]);

  const memberCount = team?.members.length ?? 0;
  const allSelected = team !== null && selected.size === memberCount;

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
      const r = await searchSlots({
        team_id: teamId,
        member_ids: Array.from(selected),
        duration_min: duration,
        buffer_min: buffer,
        window_start: new Date(start).toISOString(),
        window_end: new Date(end).toISOString(),
      });
      setResult({ slots: r.slots, truncated: r.truncated });
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
                {t.name} ({t.member_count})
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>Members ({selected.size}/{memberCount})</Label>
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
                    {(m.first_name || m.last_name) ? `${m.first_name} ${m.last_name}`.trim() : m.email}
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
            <Input id="start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="end">Until</Label>
            <Input id="end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>

        <FormError message={error} />
        <Button type="submit" disabled={submitting} className="sm:w-auto sm:px-6">
          {submitting ? "Searching…" : "Find slots"}
        </Button>
      </form>

      {result && <Results slots={result.slots} truncated={result.truncated} />}
    </>
  );
}

// ---------------------------------------------------------------------------

function Results({ slots, truncated }: { slots: Slot[]; truncated: boolean }) {
  const grouped = useMemo(() => groupByDay(slots), [slots]);

  if (slots.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
        No shared slots in that window. Try a longer window, smaller duration, or fewer members.
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          Found {slots.length} slot{slots.length === 1 ? "" : "s"}
        </h2>
        {truncated && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            More available — narrow your search
          </span>
        )}
      </header>
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
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toLocalIso(d: Date): string {
  // <input type="datetime-local"> wants `YYYY-MM-DDTHH:MM` in local time.
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
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
