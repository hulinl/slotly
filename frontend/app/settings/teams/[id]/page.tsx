"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AuthedHeader } from "@/components/AuthedHeader";
import { CardSkeleton, ListSkeleton, PageSkeleton } from "@/components/Skeleton";
import { Button, FormError, FormSuccess, Input, Label } from "@/components/ui";
import { getSession } from "@/lib/auth";
import {
  cancelInvitation,
  deleteTeam,
  getTeam,
  inviteToTeam,
  leaveTeam,
  removeMember,
  resendInvitation,
  TeamsApiError,
  updateMemberRole,
  updateTeam,
  type TeamDetail,
  type TeamRole,
} from "@/lib/teams";

export default function TeamDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const teamId = Number(params.id);
  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<{ id?: number; email?: string }>({});

  async function refresh() {
    setTeam(await getTeam(teamId));
  }

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session.meta?.is_authenticated || !session.data?.user) {
        router.replace("/auth/login");
        return;
      }
      setMe({ id: session.data.user.id, email: session.data.user.email });
      try {
        await refresh();
      } catch (err) {
        if (err instanceof TeamsApiError && err.status === 404) {
          router.replace("/settings/teams");
          return;
        }
        setError(err instanceof Error ? err.message : "Load failed");
      }
    })().catch(() => router.replace("/auth/login"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  if (error) {
    return (
      <Shell email={me.email ?? ""} onLogout={() => router.replace("/")}>
        <FormError message={error} />
      </Shell>
    );
  }
  if (!team) {
    return (
      <PageSkeleton>
        <ListSkeleton rows={4} />
        <CardSkeleton rows={3} className="mt-6" />
      </PageSkeleton>
    );
  }

  const amAdmin = team.my_role === "admin";

  async function onLeave() {
    if (!confirm(`Leave “${team!.name}”?`)) return;
    try {
      await leaveTeam(teamId);
      router.replace("/settings/teams");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Leave failed");
    }
  }

  async function onDelete() {
    if (!confirm(`Delete team “${team!.name}”? This removes all members and invitations.`)) return;
    try {
      await deleteTeam(teamId);
      router.replace("/settings/teams");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <Shell email={me.email ?? ""} onLogout={() => router.replace("/")}>
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-zinc-500">
          <Link href="/settings/teams" className="underline">Teams</Link> / {team.name}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{team.name}</h1>
        {team.description && <p className="text-sm text-zinc-600 dark:text-zinc-400">{team.description}</p>}
      </div>

      <RosterCard
        team={team}
        meId={me.id}
        amAdmin={amAdmin}
        onChanged={refresh}
      />

      {amAdmin && (
        <>
          <InviteCard teamId={teamId} onInvited={refresh} />
          <PendingInvitations team={team} onChanged={refresh} />
          <SettingsCard team={team} onSaved={refresh} />
        </>
      )}

      <DangerZone
        amAdmin={amAdmin}
        onLeave={onLeave}
        onDelete={onDelete}
      />
    </Shell>
  );
}

// ---------------------------------------------------------------------------

function Shell({
  email,
  onLogout,
  children,
}: {
  email: string;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  void onLogout;
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <AuthedHeader email={email} />
      <main className="mx-auto max-w-2xl space-y-8 px-6 py-10">{children}</main>
    </div>
  );
}

function RosterCard({
  team,
  meId,
  amAdmin,
  onChanged,
}: {
  team: TeamDetail;
  meId?: number;
  amAdmin: boolean;
  onChanged: () => void;
}) {
  async function onChangeRole(userId: number, role: TeamRole) {
    try {
      await updateMemberRole(team.id, userId, role);
      await onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Update failed");
    }
  }
  async function onRemove(userId: number) {
    if (!confirm("Remove this member from the team?")) return;
    try {
      await removeMember(team.id, userId);
      await onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Remove failed");
    }
  }
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <header className="mb-3">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          Members ({team.member_count})
        </h2>
      </header>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {team.members.map((m) => (
          <li key={m.user_id} className="flex items-center gap-3 py-3">
            <Link
              href={`/people/${m.user_id}`}
              className="min-w-0 flex-1 hover:underline"
              title="View profile"
            >
              <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {(m.first_name || m.last_name) ? `${m.first_name} ${m.last_name}`.trim() : m.email}
              </p>
              {(m.first_name || m.last_name) && (
                <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{m.email}</p>
              )}
            </Link>
            <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
              {m.role}
            </span>
            {amAdmin && (
              <>
                {m.role === "member" ? (
                  <button
                    onClick={() => onChangeRole(m.user_id, "admin")}
                    className="text-xs text-zinc-600 underline dark:text-zinc-300"
                  >
                    Promote
                  </button>
                ) : (
                  m.user_id !== meId && (
                    <button
                      onClick={() => onChangeRole(m.user_id, "member")}
                      className="text-xs text-zinc-600 underline dark:text-zinc-300"
                    >
                      Demote
                    </button>
                  )
                )}
                {m.user_id !== meId && (
                  <button
                    onClick={() => onRemove(m.user_id)}
                    className="text-xs text-red-600 underline dark:text-red-300"
                  >
                    Remove
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function InviteCard({ teamId, onInvited }: { teamId: number; onInvited: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("member");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await inviteToTeam(teamId, email, role);
      setSuccess(`Invitation sent to ${email}.`);
      setEmail("");
      onInvited();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <header className="mb-3">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Invite a teammate</h2>
        <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
          Send an email invitation. Unregistered users will be added automatically once they verify their email.
        </p>
      </header>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@company.com"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as TeamRole)}
            className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-950"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <Button type="submit" disabled={submitting} className="sm:w-auto sm:px-6">
            {submitting ? "Sending…" : "Send invite"}
          </Button>
        </div>
        <FormError message={error} />
        <FormSuccess message={success} />
      </form>
    </section>
  );
}

function PendingInvitations({ team, onChanged }: { team: TeamDetail; onChanged: () => void }) {
  if (team.invitations.length === 0) return null;
  async function onCancel(invId: number) {
    try {
      await cancelInvitation(team.id, invId);
      await onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Cancel failed");
    }
  }
  async function onResend(invId: number) {
    try {
      await resendInvitation(team.id, invId);
      alert("Invitation re-sent.");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Resend failed");
    }
  }
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <header className="mb-3">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Pending invitations</h2>
      </header>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {team.invitations.map((inv) => (
          <li key={inv.id} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-zinc-900 dark:text-zinc-50">{inv.invited_email}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Invited as {inv.role_on_accept} • expires {new Date(inv.expires_at).toLocaleDateString()}
              </p>
            </div>
            <button
              onClick={() => onResend(inv.id)}
              className="text-xs text-zinc-600 underline dark:text-zinc-300"
            >
              Resend
            </button>
            <button
              onClick={() => onCancel(inv.id)}
              className="text-xs text-red-600 underline dark:text-red-300"
            >
              Cancel
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SettingsCard({ team, onSaved }: { team: TeamDetail; onSaved: () => void }) {
  const [name, setName] = useState(team.name);
  const [desc, setDesc] = useState(team.description);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await updateTeam(team.id, { name, description: desc });
      await onSaved();
      setSuccess("Saved.");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <header className="mb-3">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Team settings</h2>
      </header>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="settings-name">Name</Label>
          <Input id="settings-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="settings-desc">Description</Label>
          <Input id="settings-desc" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
        <FormSuccess message={success} />
        <Button type="submit" disabled={submitting} className="sm:w-auto sm:px-6">
          {submitting ? "Saving…" : "Save"}
        </Button>
      </form>
    </section>
  );
}

function DangerZone({
  amAdmin,
  onLeave,
  onDelete,
}: {
  amAdmin: boolean;
  onLeave: () => void;
  onDelete: () => void;
}) {
  return (
    <section className="rounded-xl border border-red-200 bg-red-50/50 p-6 dark:border-red-900 dark:bg-red-950/20">
      <header className="mb-3">
        <h2 className="text-base font-semibold text-red-900 dark:text-red-200">Danger zone</h2>
      </header>
      <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
        <button
          onClick={onLeave}
          className="rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 dark:border-red-900 dark:text-red-200 dark:hover:bg-red-950/40"
        >
          Leave team
        </button>
        {amAdmin && (
          <button
            onClick={onDelete}
            className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Delete team
          </button>
        )}
      </div>
      <p className="mt-3 text-xs text-red-700/80 dark:text-red-200/70">
        If you&apos;re the only admin and leave, the team will be deleted automatically.
      </p>
    </section>
  );
}
