import type { HTMLAttributes } from "react";

/**
 * Animated placeholder block. Replace `Loading…` text with a layout-shaped
 * stack of these so the eye lands on the right structure when content arrives.
 */
export function Skeleton({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-zinc-200 dark:bg-zinc-800 ${className}`}
    />
  );
}

/** Header strip used at the top of every authed page. */
export function HeaderSkeleton() {
  return (
    <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
      <Skeleton className="h-5 w-16" />
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-md" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-12" />
      </div>
    </div>
  );
}

/** Generic card skeleton: title + a few rows of content. */
export function CardSkeleton({ rows = 3, className = "" }: { rows?: number; className?: string }) {
  return (
    <section
      className={`rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      <Skeleton className="mb-4 h-5 w-40" />
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    </section>
  );
}

/** List-of-rows skeleton — for things like teams list, members, calendars. */
export function ListSkeleton({ rows = 4, className = "" }: { rows?: number; className?: string }) {
  return (
    <ul
      className={`divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-5 py-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="ml-auto h-4 w-16" />
          <Skeleton className="h-4 w-20" />
        </li>
      ))}
    </ul>
  );
}

/** Page-level shell shown while we're verifying the session. */
export function PageSkeleton({ children }: { children?: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <HeaderSkeleton />
      <main className="mx-auto max-w-2xl space-y-6 px-6 py-10">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-64" />
        {children ?? <CardSkeleton rows={4} />}
      </main>
    </div>
  );
}
