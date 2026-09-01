"use client";

/**
 * /bookings — inbox for in-person meeting requests. Online bookings never
 * land here; they hit the calendar directly. This page shows requests that
 * are waiting for the host's decision, with approve/reject actions.
 */

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CalendarClock, Check, X as XIcon } from "lucide-react";
import { AuthedHeader } from "@/components/AuthedHeader";
import { CardSkeleton, PageSkeleton } from "@/components/Skeleton";
import { Button, FormError } from "@/components/ui";
import { getSession } from "@/lib/auth";
import {
  decideBookingRequest,
  listBookingRequests,
  type BookingRequestRow,
} from "@/lib/google";

export default function BookingsPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string>("");
  const [rows, setRows] = useState<BookingRequestRow[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<number>>(new Set());

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session.meta?.is_authenticated) {
        router.replace("/auth/login?next=/bookings");
        return;
      }
      setEmail(session.data?.user?.email ?? "");
      refresh(showAll);
    })().catch(() => router.replace("/auth/login"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function refresh(all: boolean) {
    try {
      const list = await listBookingRequests(all ? "all" : "pending");
      setRows(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load requests");
    }
  }

  async function decide(id: number, decision: "approve" | "reject") {
    const note =
      decision === "reject"
        ? prompt("Optional note to send the requester (leave blank to skip):") ?? ""
        : "";
    setBusy((b) => new Set(b).add(id));
    setError(null);
    try {
      const updated = await decideBookingRequest(id, decision, note);
      setRows((prev) =>
        (prev ?? []).map((r) => (r.id === id ? updated : r)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't submit decision");
    } finally {
      setBusy((b) => {
        const next = new Set(b);
        next.delete(id);
        return next;
      });
    }
  }

  if (!email || rows === null) {
    return (
      <PageSkeleton>
        <CardSkeleton rows={4} />
      </PageSkeleton>
    );
  }

  const pending = rows.filter((r) => r.status === "pending");
  const decided = rows.filter((r) => r.status !== "pending");

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <AuthedHeader email={email} />
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Booking requests
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              People asking to meet in person via your public link. Approve
              and Slotly creates the calendar event and invites them.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => {
                setShowAll(e.target.checked);
                setRows(null);
                refresh(e.target.checked);
              }}
            />
            Show decided too
          </label>
        </header>

        {error && <FormError message={error} />}

        {pending.length === 0 && !showAll ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            No requests waiting for you.
          </div>
        ) : (
          <ul className="space-y-3">
            {pending.map((r) => (
              <RequestCard
                key={r.id}
                row={r}
                onApprove={() => decide(r.id, "approve")}
                onReject={() => decide(r.id, "reject")}
                busy={busy.has(r.id)}
              />
            ))}
            {showAll && decided.length > 0 && (
              <li className="pt-2 text-xs uppercase tracking-wider text-zinc-400">
                Decided
              </li>
            )}
            {showAll &&
              decided.map((r) => <RequestCard key={r.id} row={r} muted />)}
          </ul>
        )}
      </main>
    </div>
  );
}

function RequestCard({
  row,
  onApprove,
  onReject,
  busy,
  muted = false,
}: {
  row: BookingRequestRow;
  onApprove?: () => void;
  onReject?: () => void;
  busy?: boolean;
  muted?: boolean;
}) {
  const start = new Date(row.start);
  const end = new Date(row.end);
  const dayLabel = start.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const timeLabel = `${fmt(start)}–${fmt(end)}`;

  return (
    <li
      className={
        "rounded-xl border p-4 shadow-sm " +
        (muted
          ? "border-zinc-100 bg-zinc-50 opacity-80 dark:border-zinc-800/60 dark:bg-zinc-900/40"
          : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900")
      }
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {row.visitor_name || row.visitor_email}
            </h3>
            <StatusPill status={row.status} />
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{row.visitor_email}</p>
        </div>
        <span className="inline-flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          <CalendarClock size={14} aria-hidden />
          In person
        </span>
      </header>
      <div className="mt-3 space-y-1 text-sm text-zinc-700 dark:text-zinc-200">
        <p className="font-medium">
          {dayLabel} · {timeLabel}
        </p>
        {row.location && (
          <p>
            <span className="text-zinc-500">Where:</span> {row.location}
          </p>
        )}
        {row.title && (
          <p>
            <span className="text-zinc-500">Title:</span> {row.title}
          </p>
        )}
        {row.notes && (
          <p className="whitespace-pre-wrap text-zinc-600 dark:text-zinc-300">
            <span className="text-zinc-500">Note:</span> {row.notes}
          </p>
        )}
        {row.decision_note && row.status !== "pending" && (
          <p className="whitespace-pre-wrap text-zinc-500 dark:text-zinc-400">
            <span className="italic">Your note:</span> {row.decision_note}
          </p>
        )}
      </div>
      {row.status === "pending" && (
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="secondary"
            onClick={onReject}
            disabled={busy}
            className="sm:w-auto sm:px-4"
          >
            <XIcon size={14} className="mr-1" /> Reject
          </Button>
          <Button onClick={onApprove} disabled={busy} className="sm:w-auto sm:px-4">
            <Check size={14} className="mr-1" /> Approve
          </Button>
        </div>
      )}
    </li>
  );
}

function StatusPill({ status }: { status: BookingRequestRow["status"] }) {
  const tone: Record<BookingRequestRow["status"], string> = {
    pending: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
    approved: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
    rejected: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100",
    cancelled: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${tone[status]}`}
    >
      {status}
    </span>
  );
}

function fmt(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}
