"use client";

/**
 * /b/<uuid> — visitor-facing "manage your booking" page.
 *
 * The uuid comes from the manage URL Slotly puts in every calendar event
 * we create on the host's behalf. Access control is by unguessable uuid
 * only (no auth) — a leaked link exposes exactly one visitor's own
 * booking, nothing else.
 *
 * Currently supports Cancel only. Reschedule is a follow-up (would swap
 * this page for a picker that reuses the host's public availability view).
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, MapPin, Video } from "lucide-react";
import { Logo } from "@/components/Logo";
import { Button, FormError, Label } from "@/components/ui";
import {
  cancelManagedBooking,
  getManagedBooking,
  type ManagedBooking,
} from "@/lib/google";

export default function ManageBookingPage() {
  const params = useParams<{ uuid: string }>();
  const uuid = params.uuid;

  const [state, setState] = useState<
    "loading" | "not_found" | "load_error" | "loaded"
  >("loading");
  const [booking, setBooking] = useState<ManagedBooking | null>(null);
  const [reason, setReason] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const b = await getManagedBooking(uuid);
        if (!alive) return;
        if (b === null) {
          setState("not_found");
        } else {
          setBooking(b);
          setState("loaded");
        }
      } catch {
        if (alive) setState("load_error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [uuid]);

  async function onCancel() {
    setSubmitting(true);
    setError(null);
    try {
      const updated = await cancelManagedBooking(uuid, reason);
      setBooking(updated);
      setShowConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't cancel");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <Link href="/" aria-label="Slotly home" className="inline-flex items-center">
            <Logo size={20} />
          </Link>
        </div>
      </div>

      <main className="mx-auto max-w-2xl px-6 py-10">
        {state === "loading" && (
          <p className="text-sm text-zinc-500">Loading your booking…</p>
        )}

        {state === "not_found" && (
          <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              Booking not found
            </h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              This link doesn&apos;t match any booking. It may have been mistyped
              or the booking was already deleted from the host&apos;s calendar.
            </p>
          </div>
        )}

        {state === "load_error" && (
          <FormError message="Couldn't load this booking. Try again in a minute." />
        )}

        {state === "loaded" && booking && (
          <BookingCard
            booking={booking}
            showConfirm={showConfirm}
            onOpenConfirm={() => setShowConfirm(true)}
            onCloseConfirm={() => {
              setShowConfirm(false);
              setError(null);
            }}
            reason={reason}
            onReasonChange={setReason}
            onCancel={onCancel}
            submitting={submitting}
            error={error}
          />
        )}
      </main>
    </div>
  );
}

function BookingCard({
  booking,
  showConfirm,
  onOpenConfirm,
  onCloseConfirm,
  reason,
  onReasonChange,
  onCancel,
  submitting,
  error,
}: {
  booking: ManagedBooking;
  showConfirm: boolean;
  onOpenConfirm: () => void;
  onCloseConfirm: () => void;
  reason: string;
  onReasonChange: (v: string) => void;
  onCancel: () => void | Promise<void>;
  submitting: boolean;
  error: string | null;
}) {
  const start = new Date(booking.start);
  const end = new Date(booking.end);
  const dayLabel = start.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const timeLabel = `${fmt(start)}–${fmt(end)}`;
  const isCancelled = booking.status === "cancelled";
  const isPast = end.getTime() < Date.now();

  return (
    <>
      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
            {booking.kind === "physical" ? (
              <MapPin size={18} aria-hidden />
            ) : (
              <Video size={18} aria-hidden />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              {booking.title || `Meeting with ${booking.host_name}`}
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              with {booking.host_name}
            </p>
          </div>
          <StatusPill status={booking.status} past={isPast && !isCancelled} />
        </div>

        <dl className="mt-6 space-y-3 border-t border-zinc-100 pt-5 text-sm dark:border-zinc-800">
          <Row label="When" value={`${dayLabel} · ${timeLabel}`} />
          {booking.kind === "physical" && booking.location && (
            <Row label="Where" value={booking.location} />
          )}
          <Row
            label="Booked as"
            value={
              booking.visitor_name
                ? `${booking.visitor_name} <${booking.visitor_email}>`
                : booking.visitor_email
            }
          />
        </dl>

        {isCancelled ? (
          <div className="mt-6 flex items-start gap-2 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden />
            <p>
              This booking is cancelled
              {booking.cancelled_at
                ? ` (${new Date(booking.cancelled_at).toLocaleString()})`
                : ""}
              . The host has been notified.
            </p>
          </div>
        ) : isPast ? (
          <p className="mt-6 rounded-md bg-zinc-100 p-3 text-sm text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            This booking has already ended.
          </p>
        ) : (
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={onOpenConfirm}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
            >
              <CalendarClock size={14} aria-hidden />
              Cancel this booking
            </button>
          </div>
        )}
      </section>

      {showConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !submitting) onCloseConfirm();
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Cancel this booking?
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              The calendar event will be removed and the host will be
              notified. This can&apos;t be undone.
            </p>
            <div className="mt-4 space-y-1">
              <Label htmlFor="cancel-reason">Reason (optional)</Label>
              <textarea
                id="cancel-reason"
                value={reason}
                onChange={(e) => onReasonChange(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Let the host know if you'd like."
                className="w-full resize-y rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
              />
            </div>
            {error && <FormError message={error} />}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={onCloseConfirm}
                disabled={submitting}
                className="w-auto px-4"
              >
                Keep it
              </Button>
              <Button
                type="button"
                onClick={onCancel}
                disabled={submitting}
                className="w-auto px-5 !bg-red-600 hover:!bg-red-700 dark:!bg-red-600 dark:hover:!bg-red-700"
              >
                {submitting ? "Cancelling…" : "Yes, cancel"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-2 sm:gap-4">
      <dt className="w-20 shrink-0 text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-zinc-800 dark:text-zinc-100">{value}</dd>
    </div>
  );
}

function StatusPill({
  status,
  past,
}: {
  status: ManagedBooking["status"];
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
        Ended
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
