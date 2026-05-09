"use client";

/**
 * /connections — your peer network. Three lists: incoming requests
 * (Accept/Reject), outgoing requests (Cancel), accepted peers (Remove).
 * 'Add connection' modal asks for an email and POSTs to /api/connections/request.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus, Trash2, UserCheck, UserPlus, X } from "lucide-react";
import { AuthedHeader } from "@/components/AuthedHeader";
import { CardSkeleton, PageSkeleton } from "@/components/Skeleton";
import { Button, FormError, Input, Label } from "@/components/ui";
import { getSession } from "@/lib/auth";
import {
  acceptConnection,
  ConnectionsApiError,
  listConnections,
  rejectConnection,
  removeConnection,
  requestConnection,
  type Connection,
} from "@/lib/connections";
import { colorFromName, getInitials } from "@/lib/public-profile";

export default function ConnectionsPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [adding, setAdding] = useState(false);

  async function refresh() {
    setConnections(await listConnections());
  }

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session.meta?.is_authenticated || !session.data?.user) {
        router.replace("/auth/login?next=/connections");
        return;
      }
      setEmail(session.data.user.email);
      await refresh();
    })().catch(() => router.replace("/auth/login"));
  }, [router]);

  const incoming = useMemo(
    () => (connections ?? []).filter((c) => c.direction === "incoming"),
    [connections],
  );
  const outgoing = useMemo(
    () => (connections ?? []).filter((c) => c.direction === "outgoing"),
    [connections],
  );
  const accepted = useMemo(
    () => (connections ?? []).filter((c) => c.direction === "accepted"),
    [connections],
  );

  if (!email || connections === null) {
    return (
      <PageSkeleton>
        <CardSkeleton rows={4} />
        <CardSkeleton rows={6} className="mt-6" />
      </PageSkeleton>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <AuthedHeader email={email} />
      <main className="mx-auto max-w-2xl space-y-6 px-6 py-10">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Connections
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            People you&apos;re connected to can see your availability — and you theirs.
            Connect with anyone whose email you have on Slotly.
          </p>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={() => setAdding(true)}
            className="inline-flex !w-auto items-center gap-2 px-4"
          >
            <Plus size={16} aria-hidden />
            <span>Add connection</span>
          </Button>
        </div>

        {incoming.length > 0 && (
          <Section
            title="Incoming requests"
            description="Someone wants to connect with you."
            tone="amber"
          >
            <ConnectionList
              rows={incoming}
              onChanged={refresh}
              actions={(c) => (
                <>
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
                    className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    Decline
                  </button>
                </>
              )}
            />
          </Section>
        )}

        {outgoing.length > 0 && (
          <Section title="Sent — waiting for them" tone="zinc">
            <ConnectionList
              rows={outgoing}
              onChanged={refresh}
              actions={(c) => (
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
              )}
            />
          </Section>
        )}

        <Section
          title="Your connections"
          description="People you can search and book time with."
          tone="zinc"
        >
          {accepted.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No connections yet. Click <strong>Add connection</strong> above to invite someone by email.
            </p>
          ) : (
            <ConnectionList
              rows={accepted}
              onChanged={refresh}
              actions={(c) => (
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm(`Disconnect from ${c.peer?.display_name ?? "this person"}?`)) return;
                    await removeConnection(c.id);
                    await refresh();
                  }}
                  aria-label="Remove connection"
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30"
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              )}
            />
          )}
        </Section>
      </main>

      {adding && (
        <AddConnectionModal
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

function Section({
  title,
  description,
  tone,
  children,
}: {
  title: string;
  description?: string;
  tone: "amber" | "zinc";
  children: React.ReactNode;
}) {
  const cls =
    tone === "amber"
      ? "rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/30"
      : "rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900";
  return (
    <section className={cls}>
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
      {description && (
        <p className="mt-0.5 mb-3 text-sm text-zinc-600 dark:text-zinc-400">{description}</p>
      )}
      {!description && <div className="mb-3" />}
      {children}
    </section>
  );
}

function ConnectionList({
  rows,
  actions,
}: {
  rows: Connection[];
  onChanged: () => void | Promise<void>;
  actions: (c: Connection) => React.ReactNode;
}) {
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {rows.map((c) => (
        <li key={c.id} className="flex items-center gap-3 py-3">
          <PeerAvatar peer={c.peer} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {c.peer?.display_name ?? "Unknown"}
            </p>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{c.peer?.email ?? ""}</p>
          </div>
          {c.peer && (
            <Link
              href={`/people/${c.peer.id}`}
              className="hidden text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400 sm:inline"
            >
              View profile
            </Link>
          )}
          <div className="flex shrink-0 items-center gap-2">{actions(c)}</div>
        </li>
      ))}
    </ul>
  );
}

function PeerAvatar({ peer }: { peer: Connection["peer"] }) {
  if (!peer) {
    return (
      <div
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-zinc-300 text-xs font-semibold text-white dark:bg-zinc-700"
        aria-hidden
      >
        ?
      </div>
    );
  }
  if (peer.avatar_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={peer.avatar_url}
        alt={peer.display_name}
        className="h-9 w-9 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <div
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
      style={{ backgroundColor: colorFromName(peer.display_name) }}
      aria-hidden
    >
      {getInitials(peer.display_name)}
    </div>
  );
}

function AddConnectionModal({
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
        <h3 className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Add connection
        </h3>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="add-conn-email">Their email</Label>
            <Input
              id="add-conn-email"
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
