"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { AuthedHeader } from "@/components/AuthedHeader";
import { CardSkeleton, ListSkeleton, PageSkeleton } from "@/components/Skeleton";
import { Button, FormError, Input, Label } from "@/components/ui";
import { getSession } from "@/lib/auth";
import {
  acceptInvitation,
  createTeam,
  listMyInvitations,
  listTeams,
  rejectInvitation,
  type IncomingInvitation,
  type TeamSummary,
  TeamsApiError,
} from "@/lib/teams";

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
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Teams</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Group people together so you can search for shared availability across the whole group at once.
          </p>
        </div>
        <div className="flex justify-end">
          <Button
            onClick={() => setCreating(true)}
            className="inline-flex !w-auto items-center gap-2 px-4"
          >
            <Plus size={16} aria-hidden />
            <span>Create new team</span>
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
              Create a new team
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const t = await createTeam({ name, description: desc });
      onCreated(t);
    } catch (err) {
      setError(err instanceof TeamsApiError ? err.message : "Create failed");
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
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="team-desc">Description (optional)</Label>
        <Input id="team-desc" value={desc} onChange={(e) => setDesc(e.target.value)} />
      </div>
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={submitting} className="sm:w-auto sm:px-4">
          {submitting ? "Creating…" : "Create team"}
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
        <p>You aren&apos;t in any teams yet.</p>
        <button
          type="button"
          onClick={onAdd}
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          <Plus size={14} aria-hidden />
          Create your first team
        </button>
      </section>
    );
  }
  return (
    <section className="space-y-3">
      {teams.map((t) => (
        <Link
          key={t.id}
          href={`/settings/teams/${t.id}`}
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
