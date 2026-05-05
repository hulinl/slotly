"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Building2, Calendar, LogOut, Settings, Users, type LucideIcon } from "lucide-react";
import { logout } from "@/lib/auth";
import { Logo } from "./Logo";
import { NotificationsBell } from "./NotificationsBell";

const NAV: Array<{ href: string; label: string; icon: LucideIcon; matches: (path: string) => boolean }> = [
  {
    href: "/search",
    label: "Find a slot",
    icon: Calendar,
    matches: (p) => p === "/search",
  },
  {
    href: "/people",
    label: "People",
    icon: Users,
    matches: (p) => p === "/people" || p.startsWith("/people/"),
  },
  {
    href: "/settings/teams",
    label: "Teams",
    icon: Building2,
    matches: (p) => p.startsWith("/settings/teams"),
  },
];

export function AuthedHeader({ email }: { email: string }) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  return (
    <header className="flex items-center justify-between gap-4 border-b border-zinc-200 bg-white/70 px-6 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/70">
      <div className="flex items-center gap-6 text-sm">
        <Link href="/" aria-label="Slotly home">
          <Logo size={24} />
        </Link>
        <nav className="hidden items-center gap-1 sm:flex">
          {NAV.map((item) => {
            const active = item.matches(pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors " +
                  (active
                    ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800")
                }
              >
                <Icon size={15} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <NotificationsBell />
        <Link
          href="/settings"
          className="hidden items-center gap-1.5 rounded-md px-2 py-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 sm:inline-flex"
          title="Settings"
        >
          <Settings size={15} aria-hidden="true" />
          <span className="max-w-40 truncate">{email}</span>
        </Link>
        <button
          onClick={async () => {
            await logout();
            router.replace("/");
          }}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
          aria-label="Sign out"
        >
          <LogOut size={15} aria-hidden="true" />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
}
