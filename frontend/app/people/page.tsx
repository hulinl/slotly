"use client";

/**
 * /people — your people graph in one view: pending incoming requests at the
 * top (Accept / Decline), then a unified list of everyone you're connected
 * to or share a group with, then your sent-but-unaccepted requests.
 *
 * Replaces the previous /connections page (now redirected to /people).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { AuthedHeader } from "@/components/AuthedHeader";
import { ListSkeleton, PageSkeleton } from "@/components/Skeleton";
import { Button, FormError, Input, Label } from "@/components/ui";
import { getSession } from "@/lib/auth";
import {
  acceptConnection,
  ConnectionsApiError,
  rejectConnection,
  removeConnection,
  requestConnection,
  type Connection,
} from "@/lib/connections";
import { listPeople, type Person } from "@/lib/users";

export default function PeoplePage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [incoming, setIncoming] = useState<Connection[]>([]);
  const [outgoing, setOutgoing] = useState<Connection[]>([]);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);

  async function refresh() {
    const graph = await listPeople();
    setPeople(graph.people);
    setIncoming(graph.incoming);
    setOutgoing(graph.outgoing);
  }

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session.meta?.is_authenticated || !session.data?.user) {
        router.replace("/auth/login");
        return;
      }
      setEmail(session.data.user.email);
      await refresh();
    })().catch(() => router.replace("/auth/login"));
  }, [router]);

  const filtered = useMemo(() => {
    if (!people) return [];
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) => {
      const fullName = `${p.first_name} ${p.last_name}`.toLowerCase();
      const groups = p.shared_team_names.join(" ").toLowerCase();
      return fullName.includes(q) || p.email.toLowerCase().includes(q) || groups.includes(q);
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
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              People
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Everyone you&apos;re connected to or share a group with. Click someone to see their availability.
            </p>
          </div>
          <Button
            onClick={() => setAdding(true)}
            className="inline-flex shrink-0 !w-auto items-center gap-2 px-4"
          >
            <Plus size={16} aria-hidden />
            <span>Add person</span>
          </Button>
        </div>

        {incoming.length > 0 && (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/30">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Incoming requests
            </h2>
            <p className="mt-0.5 mb-3 text-sm text-zinc-600 dark:text-zinc-400">
              Someone wants to connect with you.
            </p>
            <ul className="divide-y divide-amber-200/60 dark:divide-amber-900/60">
              {incoming.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-3">
                  <PersonAvatar
                    label={c.peer?.display_name ?? c.peer?.email ?? "?"}
                    avatarUrl={c.peer?.avatar_url ?? null}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                      {c.peer?.display_name ?? "Unknown"}
                    </p>
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {c.peer?.email ?? ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await acceptConnection(c.id);
                        await refresh();
                      }}
                      className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await rejectConnection(c.id);
                        await refresh();
                      }}
                      className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      Decline
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, email, or group…"
        />

        {filtered.length === 0 ? (
          <section className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
            {people.length === 0 ? (
              <>
                No connections or group-mates yet. Click <strong>Add person</strong> above to invite
                someone, or{" "}
                <Link href="/groups" className="font-medium text-zinc-900 underline dark:text-zinc-50">
                  create a group
                </Link>
                .
              </>
            ) : (
              "No matches."
            )}
          </section>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {filtered.map((p) => (
              <PersonRow key={p.id} person={p} onChanged={refresh} />
            ))}
          </ul>
        )}

        {outgoing.length > 0 && (
          <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Sent — waiting for them
            </h2>
            <p className="mt-0.5 mb-3 text-sm text-zinc-600 dark:text-zinc-400">
              They haven&apos;t accepted yet.
            </p>
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {outgoing.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-3">
                  <PersonAvatar
                    label={c.peer?.display_name ?? c.peer?.email ?? "?"}
                    avatarUrl={c.peer?.avatar_url ?? null}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                      {c.peer?.display_name ?? "Unknown"}
                    </p>
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {c.peer?.email ?? ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm("Cancel your request?")) return;
                      await removeConnection(c.id);
                      await refresh();
                    }}
                    className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <span className="inline-flex items-center gap-1">
                      <X size={12} aria-hidden /> Cancel
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      {adding && (
        <AddPersonModal
          onCancel={() => setAdding(false)}
          onCreated={async () => {
            setAdding(false);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function PersonRow({ person, onChanged }: { person: Person; onChanged: () => void | Promise<void> }) {
  const fullName = `${person.first_name} ${person.last_name}`.trim() || person.email;
  return (
    <li>
      <div className="flex items-center gap-4 px-5 py-3">
        <Link
          href={`/people/${person.id}`}
          className="flex min-w-0 flex-1 items-center gap-4 hover:opacity-80"
        >
          <PersonAvatar label={fullName} avatarUrl={null} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">{fullName}</p>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{person.email}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {person.connection_id !== null && (
                <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200">
                  Connected
                </span>
              )}
              {person.shared_team_names.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </Link>
        {person.connection_id !== null && (
          <button
            type="button"
            onClick={async () => {
              if (!confirm(`Disconnect from ${fullName}?`)) return;
              await removeConnection(person.connection_id!);
              await onChanged();
            }}
            aria-label="Disconnect"
            title="Disconnect"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30"
          >
            <Trash2 size={14} aria-hidden />
          </button>
        )}
      </div>
    </li>
  );
}

function PersonAvatar({ label, avatarUrl }: { label: string; avatarUrl: string | null }) {
  if (avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={avatarUrl}
        alt={label}
        className="h-10 w-10 shrink-0 rounded-full object-cover"
      />
    );
  }
  const parts = label.trim().split(/\s+/);
  const initials = (
    (parts[0]?.[0] ?? label[0] ?? "?") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")
  ).toUpperCase();
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white dark:bg-zinc-50 dark:text-zinc-900">
      {initials}
    </div>
  );
}

function AddPersonModal({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      const c = await requestConnection(email);
      if (c.direction === "accepted") {
        setInfo("Connected — they had already requested you.");
      } else {
        setInfo("Request sent. Waiting for them to accept.");
      }
      setTimeout(() => onCreated(), 700);
    } catch (err) {
      setError(err instanceof ConnectionsApiError ? err.message : "Request failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4"
      role="dialog"
      aria-modal
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
        <h3 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Add person</h3>
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
          Send a connection request — once they accept, you&apos;ll see each other&apos;s availability.
        </p>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="add-person-email">Their email</Label>
            <Input
              id="add-person-email"
              type="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
          </div>
          {info && (
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              {info}
            </p>
          )}
          <FormError message={error} />
          <div className="flex gap-2">
            <Button type="submit" disabled={submitting} className="sm:w-auto sm:px-4">
              {submitting ? "Sending…" : "Send request"}
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
      </div>
    </div>
  );
}
