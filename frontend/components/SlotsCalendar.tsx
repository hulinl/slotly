"use client";

/**
 * Weekly calendar view of search results. Each day is a column; the time
 * axis runs vertically. Adjacent slots that are 15 minutes apart get merged
 * into a single free-block — a 1-hour search returning slots every 15 min
 * from 08:00 to 16:00 collapses to one block "08:00 – 17:00" rather than
 * 33 stacked tiles.
 */

import { useEffect, useMemo, useState } from "react";
import type { Slot } from "@/lib/search";

const HOUR_PX = 48;          // pixel height of one hour row
const GAP_GRACE_MIN = 15;    // adjacent slots within this gap merge
const DEFAULT_MIN_HOUR = 7;
const DEFAULT_MAX_HOUR = 19;

type FreeInterval = { start: Date; end: Date };

export function SlotsCalendar({ slots, durationMin }: { slots: Slot[]; durationMin: number }) {
  const intervalsByDay = useMemo(() => groupAndMerge(slots), [slots]);

  // Default the calendar to the first week that contains a slot.
  const sortedDayKeys = useMemo(
    () => Array.from(intervalsByDay.keys()).sort(),
    [intervalsByDay],
  );
  const [weekStart, setWeekStart] = useState<Date>(() =>
    sortedDayKeys.length > 0 ? mondayOf(parseDayKey(sortedDayKeys[0])) : mondayOf(new Date()),
  );

  // If new search results arrive, hop the calendar back to the first week
  // that contains any of them.
  useEffect(() => {
    if (sortedDayKeys.length > 0) {
      setWeekStart(mondayOf(parseDayKey(sortedDayKeys[0])));
    }
  }, [sortedDayKeys]);

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // Auto-fit time axis to this week's data, with sane defaults when empty.
  const visibleIntervals = weekDays.flatMap((d) => intervalsByDay.get(toDayKey(d)) ?? []);
  const minHour = visibleIntervals.length
    ? Math.max(0, Math.min(...visibleIntervals.map((i) => i.start.getHours())))
    : DEFAULT_MIN_HOUR;
  const maxHour = visibleIntervals.length
    ? Math.min(
        24,
        Math.max(...visibleIntervals.map((i) => Math.ceil(toMinutes(i.end) / 60))),
      )
    : DEFAULT_MAX_HOUR;
  const hours = Array.from({ length: maxHour - minHour }, (_, i) => minHour + i);

  const totalSlotsThisWeek = visibleIntervals.length;

  function nudgeWeek(delta: -1 | 1) {
    setWeekStart((w) => addDays(w, 7 * delta));
  }

  const isCurrentWeek = sameDay(weekStart, mondayOf(new Date()));
  const weekEnd = addDays(weekStart, 6);
  const isoWk = isoWeekNumber(weekStart);
  const rangeLabel = formatWeekRange(weekStart, weekEnd);

  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {/* navigation */}
      <header className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => nudgeWeek(-1)}
            aria-label="Previous week"
            className="rounded-md border border-zinc-200 px-2.5 py-1 text-sm leading-none hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(mondayOf(new Date()))}
            disabled={isCurrentWeek}
            className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 disabled:opacity-40 disabled:hover:bg-transparent dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => nudgeWeek(1)}
            aria-label="Next week"
            className="rounded-md border border-zinc-200 px-2.5 py-1 text-sm leading-none hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            ›
          </button>
        </div>
        <h3 className="min-w-0 truncate text-right text-sm font-medium text-zinc-900 dark:text-zinc-50">
          Week {isoWk}
          <span className="text-zinc-400"> · </span>
          <span className="font-normal text-zinc-600 dark:text-zinc-400">{rangeLabel}</span>
          {totalSlotsThisWeek === 0 && (
            <span className="ml-2 text-xs text-zinc-500">no slots</span>
          )}
        </h3>
      </header>

      {/* day headers */}
      <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-zinc-100 dark:border-zinc-800">
        <div />
        {weekDays.map((day) => {
          const isToday = sameDay(day, new Date());
          return (
            <div
              key={day.toISOString()}
              className={
                "border-l border-zinc-100 px-2 py-2 text-center dark:border-zinc-800 " +
                (isToday ? "bg-zinc-50 dark:bg-zinc-800/30" : "")
              }
            >
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                {day.toLocaleDateString(undefined, { weekday: "short" })}
              </div>
              <div
                className={
                  "text-sm " +
                  (isToday
                    ? "font-bold text-zinc-900 dark:text-zinc-50"
                    : "text-zinc-700 dark:text-zinc-300")
                }
              >
                {day.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
              </div>
            </div>
          );
        })}
      </div>

      {/* time grid */}
      <div className="grid grid-cols-[56px_repeat(7,1fr)]">
        {/* time axis */}
        <div>
          {hours.map((h) => (
            <div
              key={h}
              style={{ height: HOUR_PX }}
              className="relative border-t border-zinc-100 pr-2 text-right text-[10px] text-zinc-500 dark:border-zinc-800"
            >
              <span className="absolute -top-1.5 right-2">{String(h).padStart(2, "0")}:00</span>
            </div>
          ))}
        </div>

        {/* day columns */}
        {weekDays.map((day) => {
          const intervals = intervalsByDay.get(toDayKey(day)) ?? [];
          return (
            <div
              key={day.toISOString()}
              className="relative border-l border-zinc-100 dark:border-zinc-800"
              style={{ height: hours.length * HOUR_PX }}
            >
              {/* hour gridlines */}
              {hours.map((h, i) => (
                <div
                  key={h}
                  className="absolute left-0 right-0 border-t border-zinc-100 dark:border-zinc-800"
                  style={{ top: i * HOUR_PX }}
                />
              ))}
              {/* free interval blocks */}
              {intervals.map((iv, i) => {
                const startMin = toMinutes(iv.start);
                const endMin = toMinutes(iv.end);
                const top = ((startMin - minHour * 60) * HOUR_PX) / 60;
                const height = Math.max(18, ((endMin - startMin) * HOUR_PX) / 60);
                return (
                  <div
                    key={i}
                    className="absolute inset-x-1 cursor-pointer overflow-hidden rounded border border-emerald-300 bg-emerald-100 px-1 py-0.5 text-[11px] leading-tight text-emerald-900 transition-colors hover:bg-emerald-200 dark:border-emerald-700/60 dark:bg-emerald-900/40 dark:text-emerald-100 dark:hover:bg-emerald-900/60"
                    style={{ top, height }}
                    title={`Free for a ${durationMin}-min meeting any time between ${formatHM(iv.start)} and ${formatHM(iv.end)}.\nLatest possible start: ${formatHM(new Date(iv.end.getTime() - durationMin * 60_000))}.\nClick to copy.`}
                    onClick={() =>
                      navigator.clipboard
                        ?.writeText(
                          `${day.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}, ${formatHM(iv.start)}–${formatHM(iv.end)} free`,
                        )
                        .catch(() => {})
                    }
                  >
                    <div className="font-medium">
                      {formatHM(iv.start)} – {formatHM(iv.end)}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function groupAndMerge(slots: Slot[]): Map<string, FreeInterval[]> {
  const byDay = new Map<string, FreeInterval[]>();
  if (slots.length === 0) return byDay;

  // Sort by absolute start so we can merge in one pass per day.
  const sorted = [...slots]
    .map((s) => ({ start: new Date(s.start), end: new Date(s.end) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  for (const s of sorted) {
    const key = toDayKey(s.start);
    const list = byDay.get(key) ?? [];
    if (list.length > 0) {
      const last = list[list.length - 1];
      if (s.start.getTime() <= last.end.getTime() + GAP_GRACE_MIN * 60_000) {
        last.end = new Date(Math.max(last.end.getTime(), s.end.getTime()));
        continue;
      }
    }
    list.push({ start: s.start, end: s.end });
    byDay.set(key, list);
  }

  return byDay;
}

function mondayOf(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  // getDay(): 0=Sunday, 1=Monday, ..., 6=Saturday
  const offset = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - offset);
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function toDayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDayKey(s: string): Date {
  return new Date(`${s}T00:00:00`);
}

function toMinutes(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function formatHM(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** ISO 8601 week number (Czech "kalendářní týden"). Monday-based, the week
 * containing the year's first Thursday is week 1. */
function isoWeekNumber(d: Date): number {
  const target = new Date(d.valueOf());
  target.setHours(0, 0, 0, 0);
  // Move target to Thursday of the same ISO week.
  const dayOfWeek = (target.getDay() + 6) % 7; // 0 = Mon
  target.setDate(target.getDate() - dayOfWeek + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const diffDays = (target.getTime() - firstThursday.getTime()) / 86_400_000;
  return 1 + Math.floor(diffDays / 7);
}

function formatWeekRange(start: Date, end: Date): string {
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  const day = (d: Date) => d.getDate();
  const monthShort = (d: Date) => d.toLocaleDateString(undefined, { month: "short" });
  const year = (d: Date) => d.getFullYear();
  if (sameMonth) {
    // "5–11 May 2026"
    return `${day(start)}–${day(end)} ${monthShort(end)} ${year(end)}`;
  }
  if (sameYear) {
    // "29 Apr – 5 May 2026"
    return `${day(start)} ${monthShort(start)} – ${day(end)} ${monthShort(end)} ${year(end)}`;
  }
  // "29 Dec 2025 – 4 Jan 2026"
  return `${day(start)} ${monthShort(start)} ${year(start)} – ${day(end)} ${monthShort(end)} ${year(end)}`;
}
