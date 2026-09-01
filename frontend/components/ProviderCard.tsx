"use client";

/**
 * Reusable "connected calendar" card for /settings/integrations. Renders
 * the connect/disconnect button, the connected email, the write-target
 * dropdown, and provider-specific footer copy. Same UX for Google and
 * Microsoft — passing in the provider config keeps the two cards in lock
 * step visually and interaction-wise (only the branding changes).
 */

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Plug, Unplug } from "lucide-react";
import type { WritableCalendar } from "@/lib/google";

export type ProviderStatus =
  | { connected: false }
  | {
      connected: true;
      /** Display email of the connected account. */
      email: string;
      /** Currently-selected write target — empty string is a valid sentinel
       * (Microsoft treats it as "primary calendar"). */
      write_calendar_id: string;
    };

export function ProviderCard({
  brand,
  mark,
  connectUrl,
  status,
  fetchCalendars,
  onDisconnect,
  onPickCalendar,
  disconnectConfirmText,
  revokeHref,
  footerBullets,
}: {
  brand: string;
  mark: ReactNode;
  connectUrl: string;
  status: ProviderStatus;
  fetchCalendars: () => Promise<WritableCalendar[]>;
  onDisconnect: () => Promise<void>;
  onPickCalendar: (id: string) => Promise<void>;
  disconnectConfirmText: string;
  /** Provider-specific "revoke on their end" link (Google account page,
   * Microsoft consented apps page). Optional — omit for providers that
   * don't have a user-facing revoke URL. */
  revokeHref?: { label: string; href: string };
  footerBullets: string[];
}) {
  const [busy, setBusy] = useState(false);
  const [calendars, setCalendars] = useState<WritableCalendar[] | null>(null);
  const [calendarsError, setCalendarsError] = useState<string | null>(null);
  const [savingCalendar, setSavingCalendar] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!status.connected) {
      setCalendars(null);
      setCalendarsError(null);
      return;
    }
    let alive = true;
    setCalendarsError(null);
    fetchCalendars()
      .then((list) => {
        if (alive) setCalendars(list);
      })
      .catch((err) => {
        if (alive) {
          setCalendarsError(err instanceof Error ? err.message : "Failed to load calendars");
        }
      });
    return () => {
      alive = false;
    };
  }, [status.connected, fetchCalendars]);

  async function handleDisconnect() {
    if (!confirm(disconnectConfirmText)) return;
    setBusy(true);
    try {
      await onDisconnect();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setBusy(false);
    }
  }

  async function handlePickCalendar(id: string) {
    if (!status.connected || savingCalendar) return;
    if (id === status.write_calendar_id) return;
    setSavingCalendar(true);
    setSavedMessage(null);
    try {
      await onPickCalendar(id);
      setSavedMessage("Saved. New meetings will go here.");
      setTimeout(() => setSavedMessage(null), 3000);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Couldn't save your choice");
    } finally {
      setSavingCalendar(false);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <header className="mb-4 flex items-center gap-3">
        {mark}
        <div className="flex-1">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{brand}</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {status.connected ? `Connected as ${status.email}` : "Not connected"}
          </p>
        </div>
        {status.connected ? (
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
          >
            <Unplug size={14} aria-hidden />
            {busy ? "Disconnecting…" : "Disconnect"}
          </button>
        ) : (
          <a
            href={connectUrl}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Plug size={14} aria-hidden />
            Connect {brand.split(" ")[0]}
          </a>
        )}
      </header>

      <ul className="ml-5 list-disc space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
        {footerBullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
        {revokeHref && (
          <li>
            Revoke anytime at{" "}
            <a
              className="text-indigo-700 underline dark:text-indigo-300"
              href={revokeHref.href}
              target="_blank"
              rel="noreferrer"
            >
              {revokeHref.label}
            </a>
            .
          </li>
        )}
      </ul>

      {status.connected && (
        <div className="mt-6 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <label
            htmlFor={`${brand}-write-calendar`}
            className="block text-sm font-medium text-zinc-800 dark:text-zinc-200"
          >
            Calendar for new meetings
          </label>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Meetings you book from a person&apos;s calendar or that someone
            books via your public link land here.
          </p>
          {calendarsError && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">{calendarsError}</p>
          )}
          {calendars === null && !calendarsError ? (
            <div className="mt-2 h-9 w-full max-w-md animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800" />
          ) : calendars && calendars.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <select
                id={`${brand}-write-calendar`}
                value={status.write_calendar_id}
                onChange={(e) => handlePickCalendar(e.target.value)}
                disabled={savingCalendar}
                className="min-w-[16rem] rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              >
                {/* Preserve the saved value even when the provider no longer
                    returns it in its calendars listing — hides silent drift
                    to a different-than-expected default. */}
                {!calendars.some((c) => c.id === status.write_calendar_id) &&
                  status.write_calendar_id !== "" && (
                    <option value={status.write_calendar_id}>
                      {status.write_calendar_id} (missing)
                    </option>
                  )}
                {calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.summary}
                    {c.primary ? " (primary)" : ""}
                  </option>
                ))}
              </select>
              {savingCalendar && <span className="text-xs text-zinc-500">Saving…</span>}
              {savedMessage && !savingCalendar && (
                <span className="text-xs text-emerald-600 dark:text-emerald-400">
                  {savedMessage}
                </span>
              )}
            </div>
          ) : calendars && calendars.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              No calendars found that you can write into.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
