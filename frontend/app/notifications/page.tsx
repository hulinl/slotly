"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthedHeader } from "@/components/AuthedHeader";
import { BackButton } from "@/components/BackButton";
import { ListSkeleton, PageSkeleton } from "@/components/Skeleton";
import { Button } from "@/components/ui";
import { getSession } from "@/lib/auth";
import {
  listNotifications,
  markAllRead,
  markRead,
  renderNotification,
  type Notification,
} from "@/lib/notifications";

export default function NotificationsPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);

  async function refresh() {
    const r = await listNotifications();
    setItems(r.results);
    setUnread(r.unread_count);
  }

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session.meta?.is_authenticated || !session.data?.user) {
        router.replace("/auth/login");
        return;
      }
      setEmail(session.data.user.email);
      await refresh();
      setLoaded(true);
    })().catch(() => router.replace("/auth/login"));
  }, [router]);

  if (!loaded) {
    return (
      <PageSkeleton>
        <ListSkeleton rows={5} />
      </PageSkeleton>
    );
  }

  async function onClickItem(n: Notification) {
    if (n.read_at === null) {
      await markRead(n.id);
      await refresh();
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <AuthedHeader email={email} />
      <main className="mx-auto max-w-2xl space-y-6 px-6 py-10">
        <BackButton fallback="/" />
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Notifications
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {unread > 0 ? `${unread} unread` : "All caught up."}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/settings/notifications">
              <Button variant="secondary" className="sm:w-auto sm:px-4">
                Preferences
              </Button>
            </Link>
            {unread > 0 && (
              <Button
                onClick={async () => {
                  await markAllRead();
                  await refresh();
                }}
                className="sm:w-auto sm:px-4"
              >
                Mark all read
              </Button>
            )}
          </div>
        </div>

        {items.length === 0 ? (
          <section className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
            No notifications yet.
          </section>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {items.map((n) => {
              const r = renderNotification(n);
              const inner = (
                <div className="flex items-start gap-3 px-5 py-4">
                  {n.read_at === null && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                  )}
                  <div className={n.read_at === null ? "flex-1" : "ml-4 flex-1"}>
                    <p className="text-sm text-zinc-900 dark:text-zinc-100">{r.text}</p>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {new Date(n.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              );
              return r.href ? (
                <li key={n.id}>
                  <Link
                    href={r.href}
                    onClick={() => onClickItem(n)}
                    className="block hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    {inner}
                  </Link>
                </li>
              ) : (
                <li
                  key={n.id}
                  onClick={() => onClickItem(n)}
                  className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  {inner}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
