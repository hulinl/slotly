"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  listNotifications,
  markAllRead,
  markRead,
  renderNotification,
  type Notification,
} from "@/lib/notifications";

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    try {
      const r = await listNotifications();
      setItems(r.results);
      setUnread(r.unread_count);
    } catch {
      /* ignore — bell is best-effort */
    }
  }

  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Close dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function onMarkAll() {
    await markAllRead();
    await refresh();
  }

  async function onItemClick(n: Notification) {
    if (n.read_at === null) {
      await markRead(n.id);
      await refresh();
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <BellIcon />
        {unread > 0 && (
          <span className="absolute right-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-80 rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          <header className="flex items-center justify-between border-b border-zinc-100 px-4 py-2 dark:border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Notifications</h3>
            {unread > 0 && (
              <button
                onClick={onMarkAll}
                className="text-xs text-zinc-600 underline dark:text-zinc-300"
              >
                Mark all read
              </button>
            )}
          </header>
          <ul className="max-h-96 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">
            {items.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-zinc-500">
                No notifications yet.
              </li>
            )}
            {items.slice(0, 8).map((n) => {
              const rendered = renderNotification(n);
              const inner = (
                <div className="flex items-start gap-2 px-4 py-3">
                  {n.read_at === null && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                  )}
                  <div className={n.read_at === null ? "" : "ml-4"}>
                    <p className="text-sm text-zinc-900 dark:text-zinc-100">{rendered.text}</p>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {new Date(n.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              );
              if (rendered.href) {
                return (
                  <li key={n.id}>
                    <Link
                      href={rendered.href}
                      onClick={() => onItemClick(n)}
                      className="block hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    >
                      {inner}
                    </Link>
                  </li>
                );
              }
              return (
                <li key={n.id} onClick={() => onItemClick(n)} className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800">
                  {inner}
                </li>
              );
            })}
          </ul>
          {items.length > 0 && (
            <footer className="border-t border-zinc-100 px-4 py-2 text-center dark:border-zinc-800">
              <Link
                href="/notifications"
                onClick={() => setOpen(false)}
                className="text-xs font-medium text-zinc-700 underline dark:text-zinc-300"
              >
                View all
              </Link>
            </footer>
          )}
        </div>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
