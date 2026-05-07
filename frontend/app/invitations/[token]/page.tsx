"use client";

/**
 * /invitations/<token> — landing page for the link in the team invitation
 * email. Authenticates the visitor (forwards to login with returnTo set),
 * then offers Accept / Decline. Backend validates the token and returns
 * 404 / 410 if it's been used or expired.
 */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, FormError } from "@/components/ui";
import { getSession } from "@/lib/auth";
import {
  acceptInvitation,
  rejectInvitation,
  TeamsApiError,
} from "@/lib/teams";

type State = "checking" | "ready" | "accepted" | "rejected" | "error";

export default function InvitationLandingPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params.token;

  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session.meta?.is_authenticated) {
        const returnTo = encodeURIComponent(`/invitations/${token}`);
        router.replace(`/auth/login?next=${returnTo}`);
        return;
      }
      setState("ready");
    })().catch(() => setState("error"));
  }, [token, router]);

  async function onAccept() {
    setBusy(true);
    setError(null);
    try {
      const r = await acceptInvitation(token);
      setState("accepted");
      // Land in the team they just joined
      setTimeout(() => router.replace(`/settings/teams/${r.team_id}`), 1200);
    } catch (err) {
      if (err instanceof TeamsApiError) {
        setError(
          err.status === 404 || err.status === 410
            ? "This invitation link has expired or already been used."
            : err.message,
        );
      } else {
        setError(err instanceof Error ? err.message : "Could not accept");
      }
    } finally {
      setBusy(false);
    }
  }

  async function onReject() {
    setBusy(true);
    setError(null);
    try {
      await rejectInvitation(token);
      setState("rejected");
      setTimeout(() => router.replace("/"), 1200);
    } catch (err) {
      if (err instanceof TeamsApiError) {
        setError(
          err.status === 404 || err.status === 410
            ? "This invitation link has expired or already been used."
            : err.message,
        );
      } else {
        setError(err instanceof Error ? err.message : "Could not decline");
      }
    } finally {
      setBusy(false);
    }
  }

  if (state === "checking") {
    return (
      <main className="grid min-h-screen place-items-center bg-zinc-50 dark:bg-zinc-950">
        <p className="text-sm text-zinc-500">Loading…</p>
      </main>
    );
  }

  if (state === "error") {
    return (
      <main className="grid min-h-screen place-items-center bg-zinc-50 px-6 dark:bg-zinc-950">
        <div className="mx-auto max-w-md text-center">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            Something went wrong
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            We couldn&apos;t check this invitation. Try refreshing.
          </p>
        </div>
      </main>
    );
  }

  if (state === "accepted") {
    return (
      <main className="grid min-h-screen place-items-center bg-zinc-50 px-6 dark:bg-zinc-950">
        <div className="mx-auto max-w-md text-center">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            You&apos;re in!
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Taking you to the team…
          </p>
        </div>
      </main>
    );
  }

  if (state === "rejected") {
    return (
      <main className="grid min-h-screen place-items-center bg-zinc-50 px-6 dark:bg-zinc-950">
        <div className="mx-auto max-w-md text-center">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            Invitation declined
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            We&apos;ll let them know.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center bg-zinc-50 px-6 dark:bg-zinc-950">
      <div className="mx-auto w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Team invitation
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Someone invited you to join a team on Slotly. Accept to start
          finding shared availability with them.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <Button onClick={onAccept} disabled={busy}>
            {busy ? "Accepting…" : "Accept invitation"}
          </Button>
          <Button
            variant="secondary"
            onClick={onReject}
            disabled={busy}
          >
            Decline
          </Button>
          <FormError message={error} />
          <Link
            href="/"
            className="mt-2 self-center text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            Decide later
          </Link>
        </div>
      </div>
    </main>
  );
}
