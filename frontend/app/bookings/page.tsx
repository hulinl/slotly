"use client";

/**
 * /bookings — the host's inbox. Two tabs:
 *   - Requests: pending in-person BookingRequests waiting for approval.
 *   - Confirmed: all confirmed Booking rows (online + approved physical),
 *     both upcoming and past.
 *
 * Online bookings never appear on the Requests tab (they auto-confirm
 * as soon as the visitor clicks Book). Approved physical requests DO
 * appear on Confirmed — they spawn a Booking row on approval.
 */

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CalendarClock, Check, MapPin, Video, X as XIcon } from "lucide-react";
import { AuthedHeader } from "@/components/AuthedHeader";
import { CardSkeleton, PageSkeleton } from "@/components/Skeleton";
import { Button, FormError } from "@/components/ui";
import { getSession } from "@/lib/auth";
import {
  cancelHostBooking,
  decideBookingRequest,
  listBookingRequests,
  listHostBookings,
  type BookingRequestRow,
  type HostBooking,
} from "@/lib/google";

type Tab = "requests" | "confirmed";

export default function BookingsPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string>("");
  const [tab, setTab] = useState<Tab>("requests");

  // Requests tab state
  const [requestRows, setRequestRows] = useState<BookingRequestRow[] | null>(null);
  const [requestsShowAll, setRequestsShowAll] = useState(false);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [decideBusy, setDecideBusy] = useState<Set<number>>(new Set());

  // Confirmed tab state
  const [confirmedRows, setConfirmedRows] = useState<HostBooking[] | null>(null);
  const [confirmedFilter, setConfirmedFilter] = useState<"upcoming" | "past" | "cancelled">("upcoming");
  const [confirmedError, setConfirmedError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session.meta?.is_authenticated) {
        router.replace("/auth/login?next=/bookings");
        return;
      }
      setEmail(session.data?.user?.email ?? "");
      refreshRequests(requestsShowAll);
      refreshConfirmed(confirmedFilter);
    })().catch(() => router.replace("/auth/login"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function refreshRequests(all: boolean) {
    try {
      const list = await listBookingRequests(all ? "all" : "pending");
      setRequestRows(list);
    } catch (err) {
      setRequestsError(err instanceof Error ? err.message : "Couldn't load requests");
    }
  }

  async function refreshConfirmed(filter: "upcoming" | "past" | "cancelled") {
    try {
      const list = await listHostBookings(filter);
      setConfirmedRows(list);
    } catch (err) {
      setConfirmedError(err instanceof Error ? err.message : "Couldn't load bookings");
    }
  }

  async function decide(id: number, decision: "approve" | "reject") {
    const note =
      decision === "reject"
        ? prompt("Optional note to send the requester (leave blank to skip):") ?? ""
        : "";
    setDecideBusy((b) => new Set(b).add(id));
    setRequestsError(null);
    try {
      const updated = await decideBookingRequest(id, decision, note);
      setRequestRows((prev) => (prev ?? []).map((r) => (r.id === id ? updated : r)));
      // A newly-approved request spawns a Booking row — refresh confirmed
      // tab in the background so it shows up next time user switches.
      if (decision === "approve") refreshConfirmed(confirmedFilter);
    } catch (err) {
      setRequestsError(err instanceof Error ? err.message : "Couldn't submit decision");
    } finally {
      setDecideBusy((b) => {
        const next = new Set(b);
        next.delete(id);
        return next;
      });
    }
  }

  if (!email) {
    return (
      <PageSkeleton>
        <CardSkeleton rows={4} />
      </PageSkeleton>
    );
  }

  const pendingCount =
    requestRows === null
      ? null
      : requestRows.filter((r) => r.status === "pending").length;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <AuthedHeader email={email} />
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Bookings
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Approve in-person meeting requests, and see everything that&apos;s
            been booked with you.
          </p>
        </header>

        {/* Tab strip */}
        <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
          <TabButton
            active={tab === "requests"}
            onClick={() => setTab("requests")}
            label="Requests"
            badge={pendingCount ?? undefined}
          />
          <TabButton
            active={tab === "confirmed"}
            onClick={() => setTab("confirmed")}
            label="Confirmed"
          />
        </div>

        {tab === "requests" ? (
          <RequestsPanel
            rows={requestRows}
            error={requestsError}
            showAll={requestsShowAll}
            onToggleShowAll={(v) => {
              setRequestsShowAll(v);
              setRequestRows(null);
              refreshRequests(v);
            }}
            busy={decideBusy}
            onDecide={decide}
          />
        ) : (
          <ConfirmedPanel
            rows={confirmedRows}
            error={confirmedError}
            filter={confirmedFilter}
            onFilterChange={(f) => {
              setConfirmedFilter(f);
              setConfirmedRows(null);
              refreshConfirmed(f);
            }}
            onCancel={async (uuid, reason) => {
              const updated = await cancelHostBooking(uuid, reason);
              setConfirmedRows((prev) =>
                (prev ?? []).map((b) => (b.uuid === uuid ? updated : b)),
              );
            }}
          />
        )}
      </main>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-selected={active}
      role="tab"
      className={
        "-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors " +
        (active
          ? "border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-200"
          : "border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100")
      }
    >
      {label}
      {badge !== undefined && badge > 0 && (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-600 px-1.5 text-[10px] font-semibold text-white dark:bg-indigo-500">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Requests panel (physical, waiting for approval)
// ---------------------------------------------------------------------------

function RequestsPanel({
  rows,
  error,
  showAll,
  onToggleShowAll,
  busy,
  onDecide,
}: {
  rows: BookingRequestRow[] | null;
  error: string | null;
  showAll: boolean;
  onToggleShowAll: (v: boolean) => void;
  busy: Set<number>;
  onDecide: (id: number, decision: "approve" | "reject") => void | Promise<void>;
}) {
  if (rows === null && error === null) {
    return <CardSkeleton rows={4} />;
  }

  const pending = (rows ?? []).filter((r) => r.status === "pending");
  const decided = (rows ?? []).filter((r) => r.status !== "pending");

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          In-person requests waiting for your approval.
        </p>
        <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => onToggleShowAll(e.target.checked)}
          />
          Show decided too
        </label>
      </div>

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
              onApprove={() => onDecide(r.id, "approve")}
              onReject={() => onDecide(r.id, "reject")}
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
    </section>
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

// ---------------------------------------------------------------------------
// Confirmed panel (all Booking rows — online + approved physical)
// ---------------------------------------------------------------------------

function ConfirmedPanel({
  rows,
  error,
  filter,
  onFilterChange,
  onCancel,
}: {
  rows: HostBooking[] | null;
  error: string | null;
  filter: "upcoming" | "past" | "cancelled";
  onFilterChange: (f: "upcoming" | "past" | "cancelled") => void;
  onCancel: (uuid: string, reason: string) => Promise<void>;
}) {
  if (rows === null && error === null) {
    return <CardSkeleton rows={4} />;
  }

  const empty: Record<typeof filter, string> = {
    upcoming: "Nothing on the calendar yet. Share your public link to start getting bookings.",
    past: "No past bookings.",
    cancelled: "No cancelled bookings.",
  };

  return (
    <section className="space-y-3">
      <div
        role="tablist"
        aria-label="Confirmed filter"
        className="inline-flex rounded-md border border-zinc-200 bg-white text-xs font-medium dark:border-zinc-800 dark:bg-zinc-900"
      >
        {(["upcoming", "past", "cancelled"] as const).map((f, i) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={f === filter}
            onClick={() => onFilterChange(f)}
            className={
              "px-3 py-1.5 capitalize " +
              (i === 0 ? "rounded-l-md " : "") +
              (i === 2 ? "rounded-r-md " : "") +
              (f === filter
                ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800")
            }
          >
            {f}
          </button>
        ))}
      </div>

      {error && <FormError message={error} />}

      {(rows ?? []).length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          {empty[filter]}
        </div>
      ) : (
        <ul className="space-y-3">
          {(rows ?? []).map((b) => (
            <BookingCard key={b.uuid} booking={b} onCancel={onCancel} />
          ))}
        </ul>
      )}
    </section>
  );
}

function BookingCard({
  booking,
  onCancel,
}: {
  booking: HostBooking;
  onCancel: (uuid: string, reason: string) => Promise<void>;
}) {
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const start = new Date(booking.start);
  const end = new Date(booking.end);
  const dayLabel = start.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const timeLabel = `${fmt(start)}–${fmt(end)}`;
  const isPast = end.getTime() < Date.now();
  const isCancelled = booking.status === "cancelled";
  const canCancel = !isPast && !isCancelled;

  async function doCancel() {
    const reason = prompt(
      "Cancel this booking? The visitor will get an email — add an optional note:",
    );
    if (reason === null) return; // user hit Cancel on prompt
    setCancelling(true);
    setCancelError(null);
    try {
      await onCancel(booking.uuid, reason);
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <li
      className={
        "rounded-xl border p-4 shadow-sm " +
        (isCancelled || isPast
          ? "border-zinc-100 bg-zinc-50 opacity-90 dark:border-zinc-800/60 dark:bg-zinc-900/40"
          : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900")
      }
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {booking.title || booking.visitor_name || booking.visitor_email}
            </h3>
            <BookingStatusPill status={booking.status} past={isPast} />
            {booking.attendee_emails.length > 1 && (
              <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200">
                Group · {booking.attendee_emails.length}
              </span>
            )}
          </div>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {booking.attendee_emails.length > 1
              ? booking.attendee_emails.join(", ")
              : booking.visitor_email}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          {booking.kind === "physical" ? (
            <MapPin size={14} aria-hidden />
          ) : (
            <Video size={14} aria-hidden />
          )}
          {booking.kind === "physical" ? "In person" : "Online"}
        </span>
      </header>
      <div className="mt-3 space-y-1 text-sm text-zinc-700 dark:text-zinc-200">
        <p className="font-medium">
          {dayLabel} · {timeLabel}
        </p>
        {booking.title && (
          <p>
            <span className="text-zinc-500">Title:</span> {booking.title}
          </p>
        )}
        {booking.location && (
          <p>
            <span className="text-zinc-500">Where:</span> {booking.location}
          </p>
        )}
        {isCancelled && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Cancelled by {booking.cancelled_by_visitor ? "visitor" : "you"}
            {booking.cancelled_at
              ? ` on ${new Date(booking.cancelled_at).toLocaleString()}`
              : ""}
            .
          </p>
        )}
        {cancelError && (
          <p className="text-xs text-red-600 dark:text-red-400">{cancelError}</p>
        )}
      </div>
      {canCancel && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={doCancel}
            disabled={cancelling}
            className="inline-flex items-center gap-1.5 rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
          >
            <XIcon size={12} aria-hidden />
            {cancelling ? "Cancelling…" : "Cancel"}
          </button>
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

function BookingStatusPill({
  status,
  past,
}: {
  status: HostBooking["status"];
  past: boolean;
}) {
  if (status === "cancelled") {
    return (
      <span className="inline-flex items-center rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
        Cancelled
      </span>
    );
  }
  if (past) {
    return (
      <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
        Past
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
      Confirmed
    </span>
  );
}

function fmt(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}
