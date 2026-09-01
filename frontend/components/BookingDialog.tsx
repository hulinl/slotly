"use client";

/**
 * Modal for turning a clicked free interval into an actual meeting. Used
 * from two places:
 *   - /people/[id]  → authed booking with a connected teammate (peer known)
 *   - /u/[token]    → public booking by an anonymous visitor (self-identify)
 *
 * The interval passed in spans the entire free block on that day (e.g.
 * 09:00–17:00). The user picks a specific start time and duration inside
 * that window; the dialog returns ISO datetimes tied to the interval's
 * calendar day. All submission (calling the API, error handling) is done
 * by the parent — this component is purely presentation + local form state.
 */

import { useEffect, useMemo, useState } from "react";
import { Button, FormError, Input, Label } from "@/components/ui";

export type BookingKind = "online" | "physical";

export type BookingSubmit = {
  startIso: string;
  endIso: string;
  title: string;
  notes: string;
  kind: BookingKind;
  /** Non-empty only for physical bookings — the address/room. */
  location?: string;
  visitorName?: string;
  visitorEmail?: string;
};

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120];
const START_STEP_MIN = 15;

export function BookingDialog({
  open,
  onClose,
  interval,
  mode,
  defaultTitle,
  defaultDurationMin = 30,
  submitting,
  errorMessage,
  successMessage,
  onSubmit,
  hostName,
  allowPhysical = false,
}: {
  open: boolean;
  onClose: () => void;
  /** null when nothing is picked yet — dialog stays hidden. */
  interval: { start: Date; end: Date } | null;
  mode: "authed" | "public";
  /** Prefilled meeting title (e.g. "Meeting with Anna"). User can edit. */
  defaultTitle: string;
  defaultDurationMin?: number;
  submitting: boolean;
  errorMessage?: string | null;
  successMessage?: string | null;
  onSubmit: (v: BookingSubmit) => void;
  /** Only used in public mode — shown to visitors so they know whose
   * calendar they're booking. */
  hostName?: string;
  /** Show the Online / In-person toggle. Physical requests need host
   * approval and go through the /bookings queue; online books immediately.
   * Only exposed on the public flow for MVP. */
  allowPhysical?: boolean;
}) {
  const [title, setTitle] = useState(defaultTitle);
  const [notes, setNotes] = useState("");
  const [durationMin, setDurationMin] = useState(defaultDurationMin);
  const [startMin, setStartMin] = useState<number | null>(null);
  const [visitorName, setVisitorName] = useState("");
  const [visitorEmail, setVisitorEmail] = useState("");
  const [kind, setKind] = useState<BookingKind>("online");
  const [location, setLocation] = useState("");
  // Honeypot — hidden from users but scripts often fill every text input.
  const [hp, setHp] = useState("");

  const startOptions = useMemo(() => {
    if (!interval) return [] as number[];
    const first = minutesInDay(interval.start);
    const lastAllowed = minutesInDay(interval.end) - durationMin;
    if (lastAllowed < first) return [];
    const first15 = Math.ceil(first / START_STEP_MIN) * START_STEP_MIN;
    const out: number[] = [];
    for (let m = first15; m <= lastAllowed; m += START_STEP_MIN) out.push(m);
    // Always include the earliest possible start even if it doesn't land on
    // a 15-minute grid (interval starts at 09:07 → include 09:07).
    if (out.length === 0 || out[0] !== first) {
      if (first <= lastAllowed) out.unshift(first);
    }
    return out;
  }, [interval, durationMin]);

  // Reset per-open state so the dialog opens fresh each time.
  useEffect(() => {
    if (!open || !interval) return;
    setTitle(defaultTitle);
    setNotes("");
    setDurationMin(defaultDurationMin);
    setStartMin(null);
    setVisitorName("");
    setVisitorEmail("");
    setKind("online");
    setLocation("");
    setHp("");
  }, [open, interval, defaultTitle, defaultDurationMin]);

  // Auto-pick the earliest slot when duration changes and the current pick
  // becomes invalid.
  useEffect(() => {
    if (!open || !interval || startOptions.length === 0) return;
    if (startMin === null || !startOptions.includes(startMin)) {
      setStartMin(startOptions[0]);
    }
  }, [open, interval, startOptions, startMin]);

  // ESC closes.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, submitting]);

  if (!open || !interval) return null;

  const dayLabel = interval.start.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const canSubmit =
    startMin !== null &&
    startOptions.length > 0 &&
    title.trim().length > 0 &&
    !submitting &&
    (kind !== "physical" || location.trim().length > 0) &&
    (mode === "authed" || (visitorName.trim().length > 0 && isEmail(visitorEmail)));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || startMin === null || !interval) return;
    const start = new Date(interval.start);
    start.setHours(0, 0, 0, 0);
    start.setMinutes(startMin);
    const end = new Date(start.getTime() + durationMin * 60_000);
    onSubmit({
      startIso: toLocalIso(start),
      endIso: toLocalIso(end),
      title: title.trim(),
      notes: notes.trim(),
      kind,
      location: kind === "physical" ? location.trim() : undefined,
      visitorName: visitorName.trim() || undefined,
      visitorEmail: visitorEmail.trim() || undefined,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={mode === "public" ? "Book a meeting" : "Create meeting"}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
      >
        <header>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            {mode === "public"
              ? hostName
                ? `Book time with ${hostName}`
                : "Book a meeting"
              : "Create meeting"}
          </h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{dayLabel}</p>
        </header>

        {mode === "public" && (
          <>
            <div className="space-y-1">
              <Label htmlFor="visitor-name">Your name</Label>
              <Input
                id="visitor-name"
                value={visitorName}
                onChange={(e) => setVisitorName(e.target.value)}
                required
                autoComplete="name"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="visitor-email">Your email</Label>
              <Input
                id="visitor-email"
                type="email"
                value={visitorEmail}
                onChange={(e) => setVisitorEmail(e.target.value)}
                required
                autoComplete="email"
              />
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                The calendar invite will be sent here.
              </p>
            </div>
            {/* Honeypot. Left in DOM but off-screen so bots see it but users
                (and screen readers via aria-hidden) don't. */}
            <div
              aria-hidden
              className="pointer-events-none absolute -left-[9999px] h-0 w-0 overflow-hidden opacity-0"
            >
              <label>
                Website (leave empty)
                <input
                  tabIndex={-1}
                  autoComplete="off"
                  value={hp}
                  onChange={(e) => setHp(e.target.value)}
                />
              </label>
            </div>
          </>
        )}

        {allowPhysical && (
          <div className="space-y-1">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Meeting type</span>
            <div className="flex rounded-md border border-zinc-200 p-0.5 dark:border-zinc-700">
              <KindOption
                active={kind === "online"}
                onClick={() => setKind("online")}
                label="Online"
                sub="Instant · with meeting link"
              />
              <KindOption
                active={kind === "physical"}
                onClick={() => setKind("physical")}
                label="In person"
                sub="Sent as a request for approval"
              />
            </div>
          </div>
        )}

        {kind === "physical" && (
          <div className="space-y-1">
            <Label htmlFor="location">Where</Label>
            <Input
              id="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Address, meeting room, café…"
              required
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="start-time">Start</Label>
            <select
              id="start-time"
              value={startMin ?? ""}
              onChange={(e) => setStartMin(Number(e.target.value))}
              disabled={startOptions.length === 0}
              className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-950"
            >
              {startOptions.length === 0 && (
                <option value="">No time fits the picked duration</option>
              )}
              {startOptions.map((m) => (
                <option key={m} value={m}>
                  {formatMinutes(m)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="duration">Duration</Label>
            <select
              id="duration"
              value={durationMin}
              onChange={(e) => setDurationMin(Number(e.target.value))}
              className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-950"
            >
              {DURATION_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d < 60 ? `${d} min` : d % 60 === 0 ? `${d / 60} hr` : `${d} min`}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={200}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="notes">Notes (optional)</Label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={2000}
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
          />
        </div>

        {errorMessage && <FormError message={errorMessage} />}
        {successMessage && (
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            {successMessage}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={submitting}
            className="sm:w-auto sm:px-4"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!canSubmit}
            className="sm:w-auto sm:px-4"
          >
            {submitting
              ? kind === "physical" ? "Sending…" : "Booking…"
              : kind === "physical" ? "Send request" : "Book"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function KindOption({
  active,
  onClick,
  label,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "flex-1 rounded-sm px-3 py-2 text-left text-sm transition-colors " +
        (active
          ? "bg-indigo-50 text-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-100"
          : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/50")
      }
    >
      <div className="font-medium">{label}</div>
      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{sub}</div>
    </button>
  );
}

function minutesInDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function formatMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Render a Date as ISO 8601 in the browser's local time zone (no Z suffix),
 * so the server treats it as local rather than UTC. */
function toLocalIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const tzOffset = -d.getTimezoneOffset();
  const sign = tzOffset >= 0 ? "+" : "-";
  const abs = Math.abs(tzOffset);
  const oh = pad(Math.floor(abs / 60));
  const om = pad(abs % 60);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${oh}:${om}`
  );
}

function isEmail(s: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
}
