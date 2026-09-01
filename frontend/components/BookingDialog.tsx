"use client";

/**
 * Modal for turning a clicked free interval into an actual meeting. Used
 * from two places:
 *   - /people/[id]  → authed booking with a connected teammate (peer known)
 *   - /u/[token]    → public booking by an anonymous visitor (self-identify)
 *
 * Layout: bottom-sheet on phones, centered card on tablet+. Big visual
 * Online/In-person tiles; time slot picker as chips (falls back to a
 * scrollable dropdown when there are too many); duration chips limited to
 * options that actually fit the clicked free interval so the user can't
 * assemble a nonsense combo.
 */

import { useEffect, useMemo, useState } from "react";
import { MapPin, Video, X as XIcon } from "lucide-react";
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

const ALL_DURATIONS = [15, 30, 45, 60, 90, 120];
const START_STEP_MIN = 15;
const CHIP_LIMIT = 12; // switch to a dropdown when there are more slots than this

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
  interval: { start: Date; end: Date } | null;
  mode: "authed" | "public";
  defaultTitle: string;
  defaultDurationMin?: number;
  submitting: boolean;
  errorMessage?: string | null;
  successMessage?: string | null;
  onSubmit: (v: BookingSubmit) => void;
  /** Only used in public mode — shown to visitors so they know whose
   * calendar they're booking. */
  hostName?: string;
  /** Show the Online / In-person selector. Physical requests need host
   * approval; online books immediately. Only exposed on the public flow. */
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
  // Notes hidden by default — most bookings don't need them, and burying
  // the textarea behind a "+ Add note" toggle removes ~120px of default
  // dialog height (biggest single-source of vertical scroll on laptops).
  const [showNotes, setShowNotes] = useState(false);
  // Honeypot — off-screen text field that legit users never see. Bots
  // that greedily fill every input trip it and get silently 204'd.
  const [hp, setHp] = useState("");

  // Only offer durations that actually fit the clicked free block, so the
  // user can't pick "2h" inside a 30-minute gap and hit a confusing error
  // after submit. If none fit (tiny block), we fall back to allowing the
  // block's whole length as the one option.
  const intervalLenMin = useMemo(() => {
    if (!interval) return 0;
    return Math.floor((interval.end.getTime() - interval.start.getTime()) / 60_000);
  }, [interval]);

  const durationOptions = useMemo(() => {
    if (intervalLenMin <= 0) return [] as number[];
    const fits = ALL_DURATIONS.filter((d) => d <= intervalLenMin);
    return fits.length > 0 ? fits : [intervalLenMin];
  }, [intervalLenMin]);

  const startOptions = useMemo(() => {
    if (!interval) return [] as number[];
    const first = minutesInDay(interval.start);
    const lastAllowed = minutesInDay(interval.end) - durationMin;
    if (lastAllowed < first) return [];
    const first15 = Math.ceil(first / START_STEP_MIN) * START_STEP_MIN;
    const out: number[] = [];
    for (let m = first15; m <= lastAllowed; m += START_STEP_MIN) out.push(m);
    if (out.length === 0 || out[0] !== first) {
      if (first <= lastAllowed) out.unshift(first);
    }
    return out;
  }, [interval, durationMin]);

  // Reset per-open — dialog opens fresh each time. Also auto-pick sensible
  // defaults for duration + start based on the newly-clicked interval.
  useEffect(() => {
    if (!open || !interval) return;
    setTitle(defaultTitle);
    setNotes("");
    setVisitorName("");
    setVisitorEmail("");
    setKind("online");
    setLocation("");
    setHp("");
    setShowNotes(false);
    const d = ALL_DURATIONS.find((x) => x === defaultDurationMin && x <= intervalLenMin)
      ?? ALL_DURATIONS.filter((x) => x <= intervalLenMin).slice(-1)[0]
      ?? intervalLenMin;
    setDurationMin(d);
    setStartMin(null);
  }, [open, interval, defaultTitle, defaultDurationMin, intervalLenMin]);

  // If the current start becomes invalid (duration change shifts the last-
  // allowed start earlier), snap to the earliest still-valid option.
  useEffect(() => {
    if (!open || !interval || startOptions.length === 0) return;
    if (startMin === null || !startOptions.includes(startMin)) {
      setStartMin(startOptions[0]);
    }
  }, [open, interval, startOptions, startMin]);

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
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={mode === "public" ? "Book a meeting" : "Create meeting"}
    >
      <form
        onSubmit={handleSubmit}
        className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:max-w-lg sm:rounded-2xl"
      >
        {/* Sticky header — bottom-sheet look on mobile, clean on desktop */}
        <header className="flex items-center gap-3 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <div className="flex-1 min-w-0">
            <h2 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {mode === "public"
                ? hostName
                  ? `Book time with ${hostName}`
                  : "Book a meeting"
                : "Create meeting"}
            </h2>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{dayLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="Close"
          >
            <XIcon size={18} aria-hidden />
          </button>
        </header>

        {/* Body — usually fits without scroll. When it doesn't (small
            viewport + physical + long start-chip list), a thin theme-aware
            scrollbar shows rather than the browser's default black bar. */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 [scrollbar-width:thin] [scrollbar-color:theme(colors.zinc.300)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-track]:bg-transparent dark:[scrollbar-color:theme(colors.zinc.700)_transparent] dark:[&::-webkit-scrollbar-thumb]:bg-zinc-700">
          {allowPhysical && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                Meeting type
              </legend>
              <div className="grid grid-cols-2 gap-2">
                <KindTile
                  active={kind === "online"}
                  onClick={() => setKind("online")}
                  icon={<Video size={16} aria-hidden />}
                  title="Online"
                  sub="Books now · meeting link included"
                  tone="indigo"
                  recommended
                />
                <KindTile
                  active={kind === "physical"}
                  onClick={() => setKind("physical")}
                  icon={<MapPin size={16} aria-hidden />}
                  title="In person"
                  sub="Request — host approves first"
                  tone="amber"
                />
              </div>
            </fieldset>
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
                autoComplete="street-address"
              />
            </div>
          )}

          {/* Time — start chips + duration chips. Duration options are
              filtered to what actually fits the free block; start options
              re-derived from duration so the two never form a nonsense
              combo. */}
          <div className="space-y-3">
            <div>
              <Label htmlFor="duration-group">Duration</Label>
              <div id="duration-group" className="mt-1.5 flex flex-wrap gap-1.5">
                {durationOptions.map((d) => (
                  <ChipButton
                    key={d}
                    active={d === durationMin}
                    onClick={() => setDurationMin(d)}
                    label={formatDuration(d)}
                  />
                ))}
              </div>
              {durationOptions.length === 1 && durationOptions[0] < 30 && (
                <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  Only {formatDuration(durationOptions[0])} fits this free
                  block — pick another day for a longer slot.
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="start-group">Start</Label>
              {startOptions.length === 0 ? (
                <p className="mt-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
                  No start time fits the picked duration. Try a shorter one.
                </p>
              ) : startOptions.length <= CHIP_LIMIT ? (
                <div id="start-group" className="mt-1.5 flex flex-wrap gap-1.5">
                  {startOptions.map((m) => (
                    <ChipButton
                      key={m}
                      active={m === startMin}
                      onClick={() => setStartMin(m)}
                      label={formatMinutes(m)}
                    />
                  ))}
                </div>
              ) : (
                <select
                  id="start-group"
                  value={startMin ?? ""}
                  onChange={(e) => setStartMin(Number(e.target.value))}
                  className="mt-1.5 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                >
                  {startOptions.map((m) => (
                    <option key={m} value={m}>
                      {formatMinutes(m)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {mode === "public" && (
            <div className="grid gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800 sm:grid-cols-2">
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
              </div>
              {/* Honeypot — off-screen, aria-hidden. */}
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
            </div>
          )}

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

          {showNotes ? (
            <div className="space-y-1">
              <Label htmlFor="notes">Notes</Label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={2000}
                autoFocus
                placeholder={
                  kind === "physical"
                    ? "Anything the host should know before approving?"
                    : "Agenda, links, context…"
                }
                className="w-full resize-y rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:placeholder:text-zinc-500"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowNotes(true)}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
            >
              + Add a note
            </button>
          )}

          {errorMessage && <FormError message={errorMessage} />}
          {successMessage && (
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              {successMessage}
            </p>
          )}
        </div>

        {/* Sticky footer with primary action */}
        <footer className="flex items-center justify-end gap-2 border-t border-zinc-100 bg-white px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={submitting}
            className="w-auto px-4"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!canSubmit}
            className={
              "w-auto px-5 " +
              (kind === "physical"
                ? "!bg-amber-600 hover:!bg-amber-700 dark:!bg-amber-600 dark:hover:!bg-amber-700"
                : "")
            }
          >
            {submitting
              ? kind === "physical" ? "Sending…" : "Booking…"
              : kind === "physical" ? "Send request" : "Book"}
          </Button>
        </footer>
      </form>
    </div>
  );
}

function KindTile({
  active,
  onClick,
  icon,
  title,
  sub,
  tone,
  recommended = false,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  sub: string;
  tone: "indigo" | "amber";
  recommended?: boolean;
}) {
  const activeClass =
    tone === "indigo"
      ? "border-indigo-500 bg-indigo-50 ring-2 ring-indigo-500 ring-offset-1 dark:border-indigo-400 dark:bg-indigo-950/50 dark:ring-offset-zinc-900"
      : "border-amber-500 bg-amber-50 ring-2 ring-amber-500 ring-offset-1 dark:border-amber-400 dark:bg-amber-950/50 dark:ring-offset-zinc-900";
  const iconClass =
    tone === "indigo"
      ? "text-indigo-600 dark:text-indigo-300"
      : "text-amber-700 dark:text-amber-300";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "relative flex flex-col gap-1 rounded-lg border p-3 text-left transition-all " +
        (active
          ? activeClass
          : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800/60")
      }
    >
      <div className={"flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-50"}>
        <span className={iconClass}>{icon}</span>
        {title}
        {recommended && (
          <span className="ml-auto rounded-full bg-indigo-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
            Recommended
          </span>
        )}
      </div>
      <div className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{sub}</div>
    </button>
  );
}

function ChipButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "rounded-full border px-3 py-1 text-sm transition-colors " +
        (active
          ? "border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500"
          : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800")
      }
    >
      {label}
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

function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  if (min % 60 === 0) return `${min / 60} h`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
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
