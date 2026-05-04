"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { logout } from "@/lib/auth";
import { NotificationsBell } from "./NotificationsBell";

export function AuthedHeader({ email }: { email: string }) {
  const router = useRouter();
  return (
    <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
      <Link href="/" className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Slotly
      </Link>
      <div className="flex items-center gap-3 text-sm">
        <NotificationsBell />
        <span className="text-zinc-500 dark:text-zinc-400">{email}</span>
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
