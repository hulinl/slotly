"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { logout } from "@/lib/auth";
import { NotificationsBell } from "./NotificationsBell";

const NAV: Array<{ href: string; label: string; matches: (path: string) => boolean }> = [
  { href: "/search", label: "Find a slot", matches: (p) => p === "/search" },
  { href: "/people", label: "People", matches: (p) => p === "/people" || p.startsWith("/people/") },
  { href: "/settings/teams", label: "Teams", matches: (p) => p.startsWith("/settings/teams") },
];

export function AuthedHeader({ email }: { email: string }) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  return (
    <header className="flex items-center justify-between gap-4 border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
      <div className="flex items-center gap-6 text-sm">
        <Link href="/" className="font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Slotly
        </Link>
        <nav className="hidden items-center gap-4 sm:flex">
          {NAV.map((item) => {
            const active = item.matches(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  "rounded-md px-2 py-1 text-sm transition-colors " +
                  (active
                    ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800")
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <NotificationsBell />
        <Link
          href="/settings"
          className="hidden truncate text-zinc-500 hover:underline dark:text-zinc-400 sm:block"
          title="Settings"
        >
          {email}
        </Link>
        <button
          onClick={async () => {
            await logout();
            router.replace("/");
          }}
          className="text-zinc-600 underline dark:text-zinc-400"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
