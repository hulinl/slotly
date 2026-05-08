"use client";

/**
 * Sticky tab strip rendered at the top of every /settings/* page so
 * users can jump between sections without scrolling. Sections that live
 * on the main /settings page (Profile, Sharing, Working hours) link to
 * in-page anchors; the rest navigate to dedicated sub-routes.
 *
 * Teams intentionally not listed here — it's a top-nav destination on
 * its own per the wider IA decision.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  CalendarDays,
  Clock,
  Globe,
  UserCircle,
  UserCog,
  type LucideIcon,
} from "lucide-react";

type SettingsTab = {
  /** Anchor or full path. Anchors begin with `#` and only fire on /settings. */
  href: string;
  label: string;
  icon: LucideIcon;
  /** Path prefix that should highlight this tab as active. */
  activePath?: string;
};

const TABS: SettingsTab[] = [
  { href: "/settings#profile", label: "Profile", icon: UserCircle, activePath: "/settings" },
  { href: "/settings#sharing", label: "Sharing", icon: Globe, activePath: "/settings" },
  { href: "/settings#working-hours", label: "Working hours", icon: Clock, activePath: "/settings" },
  { href: "/settings/calendars", label: "Calendars", icon: CalendarDays, activePath: "/settings/calendars" },
  { href: "/settings/notifications", label: "Notifications", icon: Bell, activePath: "/settings/notifications" },
  { href: "/settings/account", label: "Account", icon: UserCog, activePath: "/settings/account" },
];

export function SettingsNav() {
  const pathname = usePathname() ?? "";
  return (
    <nav className="sticky top-0 z-30 -mx-6 mb-2 overflow-x-auto border-b border-zinc-200 bg-white/80 px-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80 sm:-mx-0 sm:rounded-lg sm:border sm:bg-white sm:px-1 sm:dark:bg-zinc-900">
      <ul className="flex min-w-max items-center gap-1 py-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active =
            t.activePath === pathname ||
            (t.activePath && t.activePath !== "/settings" && pathname.startsWith(t.activePath));
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                className={
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors " +
                  (active
                    ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800")
                }
              >
                <Icon size={14} aria-hidden="true" />
                <span>{t.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
