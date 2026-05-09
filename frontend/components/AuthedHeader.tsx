"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Building2,
  Calendar,
  LogOut,
  Menu,
  Settings,
  User,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { logout } from "@/lib/auth";
import { Logo } from "./Logo";
import { NotificationsBell } from "./NotificationsBell";

// Top-level destinations. Profile is intentionally NOT here — the email
// link in the top right already opens it, and side-by-side "Profile" +
// "People" caused users to misread which is which. Profile gets a row
// inside the mobile dropdown's account section instead.
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
    href: "/groups",
    label: "Groups",
    icon: Building2,
    matches: (p) => p === "/groups" || p.startsWith("/groups/"),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    matches: (p) => p === "/settings" || p.startsWith("/settings/"),
  },
];

export function AuthedHeader({ email }: { email: string }) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  // Close mobile menu on route change.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  async function onLogout() {
    setMenuOpen(false);
    await logout();
    router.replace("/");
  }

  return (
    <header
      ref={headerRef}
      style={{ ["--header-h" as string]: "60px" }}
      className="sticky top-0 z-40 flex h-[60px] items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950 sm:px-6"
    >
      {/* Left: logo + desktop nav */}
      <div className="flex items-center gap-4 text-sm sm:gap-6">
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

      {/* Right: bell + (desktop) profile-email + (desktop) logout + (mobile) hamburger */}
      <div className="flex items-center gap-2 text-sm">
        <NotificationsBell />

        {/* Desktop: email click → /profile (overview, then deeper /settings) */}
        <Link
          href="/profile"
          className="hidden items-center gap-1.5 rounded-md px-2 py-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 sm:inline-flex"
          title="My profile"
        >
          <User size={15} aria-hidden="true" />
          <span className="max-w-40 truncate">{email}</span>
        </Link>
        <button
          onClick={onLogout}
          className="hidden items-center gap-1.5 rounded-md px-2 py-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 sm:inline-flex"
          aria-label="Sign out"
        >
          <LogOut size={15} aria-hidden="true" />
        </button>

        {/* Mobile-only hamburger */}
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800 sm:hidden"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
        </button>
      </div>

      {/* Mobile dropdown menu — sits inside the sticky header's stacking
          context (z-40), so any z-index here automatically wins over the
          sticky SettingsNav further down the page. */}
      {menuOpen && (
        <div
          className="absolute inset-x-0 top-full z-50 border-b border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950 sm:hidden"
          role="menu"
        >
          <nav className="flex flex-col py-2">
            {NAV.map((item) => {
              const active = item.matches(pathname);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    "flex items-center gap-3 px-5 py-3 text-sm transition-colors " +
                    (active
                      ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200"
                      : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800/50")
                  }
                >
                  <Icon size={16} aria-hidden />
                  <span>{item.label}</span>
                </Link>
              );
            })}
            <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
            <Link
              href="/profile"
              className={
                "flex items-center gap-3 px-5 py-3 text-sm transition-colors " +
                (pathname === "/profile"
                  ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200"
                  : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800/50")
              }
            >
              <User size={16} aria-hidden />
              <span>My profile</span>
            </Link>
            <div className="px-5 py-2 text-xs text-zinc-500 dark:text-zinc-400">
              Signed in as
            </div>
            <div className="px-5 pb-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {email}
            </div>
            <button
              onClick={onLogout}
              className="flex items-center gap-3 px-5 py-3 text-left text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800/50"
            >
              <LogOut size={16} aria-hidden />
              <span>Sign out</span>
            </button>
          </nav>
        </div>
      )}
    </header>
  );
}
