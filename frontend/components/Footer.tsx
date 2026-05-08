/**
 * Global footer rendered from the root layout. Two attributions on a single
 * line: Slotly (indigo, the app brand, links home) and Powered by BIfactory
 * (the team — neutral grey, links to bifactory.cz). Light/dark logo variants.
 */

import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-zinc-200 bg-white py-5 px-4 dark:border-zinc-800 dark:bg-zinc-950 sm:px-6">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
        <Link
          href="/"
          className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
        >
          Slotly
        </Link>
        <span aria-hidden className="text-zinc-300 dark:text-zinc-700">·</span>
        <Link
          href="https://bifactory.cz"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
        >
          <span>Powered by</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/bifactory-logo.png"
            alt="BIfactory s.r.o."
            className="h-6 w-6 dark:hidden"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/bifactory-logo-white.png"
            alt="BIfactory s.r.o."
            className="hidden h-6 w-6 dark:block"
          />
        </Link>
      </div>
    </footer>
  );
}
