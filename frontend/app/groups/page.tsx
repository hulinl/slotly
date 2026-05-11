"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import { AuthedHeader } from "@/components/AuthedHeader";
import { CardSkeleton, ListSkeleton, PageSkeleton } from "@/components/Skeleton";
import { Button, FormError, Input, Label } from "@/components/ui";
import { getSession } from "@/lib/auth";
import {
  acceptInvitation,
  createTeam,
  inviteConnectionToTeam,
  inviteToTeam,
  listMyInvitations,
  listTeams,
  rejectInvitation,
  type IncomingInvitation,
  type TeamSummary,
  TeamsApiError,
} from "@/lib/teams";
import { listPeople, type Person } from "@/lib/users";

export default function TeamsListPage() {
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [email, setEmail] = useState("");
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [invitations, setInvitations] = useState<IncomingInvitation[]>([]);

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session.meta?.is_authenticated) {
        router.replace("/auth/login");
        return;
      }
      setEmail(session.data?.user?.email ?? "");
      const [t, inv] = await Promise.all([listTeams(), listMyInvitations()]);
      setTeams(t);
      setInvitations(inv);
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

      <main className="mx-auto max-w-2xl space-y-6 px-6 py-10">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Groups</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Bundle people together — work team, family, friends, project — so you can search for shared availability across them at once.
          </p>
        </div>
        <div className="flex justify-end">
          <Button
            onClick={() => setCreating(true)}
            className="inline-flex !w-auto items-center gap-2 px-4"
          >
            <Plus size={16} aria-hidden />
            <span>Create new group</span>
          </Button>
        </div>

        {invitations.length > 0 && (
          <InvitationsForYou
            invitations={invitations}
            onChange={(next) => setInvitations(next)}
            onAccepted={async () => setTeams(await listTeams())}
          />
        )}

        <TeamList teams={teams} onAdd={() => setCreating(true)} />
      </main>

      {creating && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4"
          role="dialog"
          aria-modal
          onClick={(e) => {
            if (e.target === e.currentTarget) setCreating(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <h3 className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Create a new group
            </h3>
            <CreateTeamForm
              onCancel={() => setCreating(false)}
              onCreated={(t) => {
                setTeams((prev) => [t, ...prev]);
                setCreating(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function InvitationsForYou({
  invitations,
  onChange,
  onAccepted,
}: {
  invitations: IncomingInvitation[];
  onChange: (next: IncomingInvitation[]) => void;
  onAccepted: () => void;
}) {
  async function onAccept(inv: IncomingInvitation) {
    try {
      await acceptInvitation(inv.token);
      onChange(invitations.filter((i) => i.id !== inv.id));
      onAccepted();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Accept failed");
    }
  }
  async function onReject(inv: IncomingInvitation) {
    try {
      await rejectInvitation(inv.token);
      onChange(invitations.filter((i) => i.id !== inv.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Reject failed");
    }
  }
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/30">
      <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">Invitations for you</h2>
      <ul className="mt-3 divide-y divide-amber-200/70 dark:divide-amber-900/60">
        {invitations.map((inv) => (
          <li key={inv.id} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-amber-950 dark:text-amber-100">{inv.team_name}</p>
              <p className="text-xs text-amber-800/80 dark:text-amber-300/80">
                Invited by {inv.invited_by_email ?? "?"} as {inv.role_on_accept}.
                Expires {new Date(inv.expires_at).toLocaleDateString()}
              </p>
            </div>
            <button
              onClick={() => onAccept(inv)}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
            >
              Accept
            </button>
            <button
              onClick={() => onReject(inv)}
              className="rounded-md border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-900/40"
            >
              Decline
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CreateTeamForm({
  onCreated,
  onCancel,
}: {
  onCreated: (t: TeamSummary) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [connections, setConnections] = useState<Person[] | null>(null);
  const [pickedIds, setPickedIds] = useState<Set<number>>(new Set());
  const [emailDraft, setEmailDraft] = useState("");
  const [emails, setEmails] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listPeople()
      .then((g) => setConnections(g.people.filter((p) => p.connection_id !== null)))
      .catch(() => setConnections([]));
  }, []);

  function togglePicked(id: number) {
    setPickedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addEmail() {
    const raw = emailDraft.trim().toLowerCase();
    if (!raw) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
      setError("That doesn't look like a valid email.");
      return;
    }
    if (emails.includes(raw)) {
      setError("You already added that email.");
      return;
    }
    setError(null);
    setEmails((prev) => [...prev, raw]);
    setEmailDraft("");
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    setProgress("Creating group…");
    try {
      const t = await createTeam({ name, description: desc });
      const failures: string[] = [];
      let connInvitedCount = 0;
      let emailInvitedCount = 0;
      for (const userId of pickedIds) {
        setProgress(`Inviting connections (${connInvitedCount + 1}/${pickedIds.size})…`);
        try {
          await inviteConnectionToTeam(t.id, userId);
          connInvitedCount += 1;
        } catch (err) {
          failures.push(err instanceof Error ? err.message : `user ${userId}`);
        }
      }
      for (const email of emails) {
        setProgress(`Sending email invitations (${emailInvitedCount + 1}/${emails.length})…`);
        try {
          await inviteToTeam(t.id, email);
          emailInvitedCount += 1;
        } catch (err) {
          failures.push(email + ": " + (err instanceof Error ? err.message : "failed"));
        }
      }
      if (failures.length > 0) {
        setError(`Group created, but some invites failed: ${failures.join("; ")}`);
        setProgress(null);
        onCreated({ ...t, member_count: 1 });
        return;
      }
      onCreated({ ...t, member_count: 1 });
    } catch (err) {
      setError(err instanceof TeamsApiError ? err.message : "Create failed");
      setProgress(null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="team-name">Name</Label>
        <Input
          id="team-name"
          autoFocus
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Family, Work, Project X…"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="team-desc">Description (optional)</Label>
        <Input id="team-desc" value={desc} onChange={(e) => setDesc(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <Label>
          Invite from your connections{" "}
          {pickedIds.size > 0 && (
            <span className="text-xs font-normal text-zinc-500">({pickedIds.size} picked)</span>
          )}
        </Label>
        {connections === null ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : connections.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-300 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700">
            No accepted connections yet. Use the email field below, or send a connection request from{" "}
            <Link href="/people" className="underline">
              People
            </Link>{" "}
            first.
          </p>
        ) : (
          <ul className="max-h-48 divide-y divide-zinc-100 overflow-y-auto rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {connections.map((p) => {
              const fullName = `${p.first_name} ${p.last_name}`.trim() || p.email;
              return (
                <li key={p.id} className="flex items-center gap-2 px-3 py-2">
                  <input
                    type="checkbox"
                    id={`pick-${p.id}`}
                    checked={pickedIds.has(p.id)}
                    onChange={() => togglePicked(p.id)}
                    className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <label htmlFor={`pick-${p.id}`} className="flex-1 cursor-pointer text-sm">
                    <span className="font-medium">{fullName}</span>
                    <span className="ml-2 text-xs text-zinc-500">{p.email}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-zinc-500">
          They&apos;ll get an in-app invitation (no email) and have to accept before joining.
          Don&apos;t see someone you share a group with? Send them a connection request first, or invite by email below.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="invite-email">Invite by email (optional)</Label>
        <div className="flex gap-2">
          <Input
            id="invite-email"
            type="email"
            value={emailDraft}
            onChange={(e) => setEmailDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addEmail();
              }
            }}
            placeholder="name@example.com"
          />
          <button
            type="button"
            onClick={addEmail}
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Add
          </button>
        </div>
        {emails.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {emails.map((em) => (
              <li
                key={em}
                className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800"
              >
                {em}
                <button
                  type="button"
                  onClick={() => setEmails((prev) => prev.filter((x) => x !== em))}
                  aria-label={`Remove ${em}`}
                  className="text-zinc-500 hover:text-red-600"
                >
                  <X size={12} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {progress && !error && (
        <p className="rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          {progress}
        </p>
      )}
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={submitting} className="sm:w-auto sm:px-4">
          {submitting
            ? "Creating…"
            : pickedIds.size + emails.length > 0
              ? `Create + invite ${pickedIds.size + emails.length}`
              : "Create group"}
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

function TeamList({ teams, onAdd }: { teams: TeamSummary[]; onAdd: () => void }) {
  if (teams.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
        <p>You aren&apos;t in any groups yet.</p>
        <button
          type="button"
          onClick={onAdd}
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          <Plus size={14} aria-hidden />
          Create your first group
        </button>
      </section>
    );
  }
  return (
    <section className="space-y-3">
      {teams.map((t) => (
        <Link
          key={t.id}
          href={`/groups/${t.id}`}
          className="block rounded-xl border border-zinc-200 bg-white p-5 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
        >
          <div className="flex items-center gap-3">
            <h3 className="flex-1 truncate font-medium text-zinc-900 dark:text-zinc-50">{t.name}</h3>
            <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
              {t.my_role ?? "—"}
            </span>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {t.member_count} member{t.member_count === 1 ? "" : "s"}
            </span>
          </div>
          {t.description && (
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.description}</p>
          )}
        </Link>
      ))}
    </section>
  );
}
