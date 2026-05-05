"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AuthedHeader } from "@/components/AuthedHeader";
import { ListSkeleton, PageSkeleton } from "@/components/Skeleton";
import { Input } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { listTeammates, type TeammateSummary } from "@/lib/users";

export default function PeopleIndexPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [people, setPeople] = useState<TeammateSummary[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session.meta?.is_authenticated || !session.data?.user) {
        router.replace("/auth/login");
        return;
      }
      setEmail(session.data.user.email);
      setPeople(await listTeammates());
    })().catch(() => router.replace("/auth/login"));
  }, [router]);

  const filtered = useMemo(() => {
    if (!people) return [];
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) => {
      const fullName = `${p.first_name} ${p.last_name}`.toLowerCase();
      const teams = p.shared_team_names.join(" ").toLowerCase();
      return fullName.includes(q) || p.email.toLowerCase().includes(q) || teams.includes(q);
    });
  }, [people, query]);

  if (email === null || people === null) {
    return (
      <PageSkeleton>
        <ListSkeleton rows={5} />
      </PageSkeleton>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <AuthedHeader email={email} />
      <main className="mx-auto max-w-2xl space-y-6 px-6 py-10">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            People
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Everyone you share a team with. Click someone to see their availability.
          </p>
        </div>

        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, email, or team…"
          autoFocus
        />

        {filtered.length === 0 ? (
          <section className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
            {people.length === 0 ? (
              <>
                You aren&apos;t in any team yet.{" "}
                <Link href="/settings/teams" className="font-medium text-zinc-900 underline dark:text-zinc-50">
                  Create a team
                </Link>{" "}
                or accept an invitation.
              </>
            ) : (
              "No matches."
            )}
          </section>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {filtered.map((p) => {
              const fullName = `${p.first_name} ${p.last_name}`.trim() || p.email;
              const initials = (
                (p.first_name || p.email[0] || "?").charAt(0) +
                (p.last_name || p.email[1] || "").charAt(0)
              ).toUpperCase();
              return (
                <li key={p.id}>
                  <Link
                    href={`/people/${p.id}`}
                    className="flex items-center gap-4 px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white dark:bg-zinc-50 dark:text-zinc-900">
                      {initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">{fullName}</p>
                      <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {p.email} · {p.shared_team_names.join(", ")}
                      </p>
                    </div>
                    <span className="text-zinc-400">→</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
