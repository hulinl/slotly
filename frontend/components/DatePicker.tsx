"use client";

import { useEffect, useRef, useState } from "react";
import { DayPicker } from "react-day-picker";

type Props = {
  id?: string;
  /** YYYY-MM-DD or empty string. */
  value: string;
  onChange: (date: string) => void;
  /** Inclusive lower bound (YYYY-MM-DD). */
  min?: string;
  /** Inclusive upper bound (YYYY-MM-DD). */
  max?: string;
  placeholder?: string;
  className?: string;
};

/**
 * A date input that pops a real calendar (react-day-picker) on click.
 * The calendar is a popover; click-outside closes it. The button shows
 * a friendly format like "5 May 2026".
 */
export function DatePicker({
  id,
  value,
  onChange,
  min,
  max,
  placeholder = "Pick a date",
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = parseLocalDate(value);
  const fromDate = parseLocalDate(min);
  const toDate = parseLocalDate(max);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  const disabledMatchers = [
    ...(fromDate ? [{ before: fromDate }] : []),
    ...(toDate ? [{ after: toDate }] : []),
  ];

  return (
    <div ref={ref} className="relative">
      <button
        id={id}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          "flex h-10 w-full items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900 dark:focus:ring-zinc-50 " +
          className
        }
      >
        <span className={selected ? "" : "text-zinc-400"}>
          {selected ? formatPretty(selected) : placeholder}
        </span>
        <CalendarIcon />
      </button>
      {open && (
        <div className="absolute left-0 top-12 z-50 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          <DayPicker
            mode="single"
            selected={selected}
            onSelect={(d) => {
              if (!d) return;
              onChange(toIsoDate(d));
              setOpen(false);
            }}
            disabled={disabledMatchers.length ? disabledMatchers : undefined}
            weekStartsOn={1}
            captionLayout="dropdown"
            startMonth={new Date(new Date().getFullYear() - 1, 0)}
            endMonth={new Date(new Date().getFullYear() + 5, 11)}
          />
        </div>
      )}
    </div>
  );
}

function parseLocalDate(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  // Treat YYYY-MM-DD as local midnight to avoid TZ shifts.
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function toIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatPretty(d: Date): string {
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function CalendarIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-zinc-400"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
