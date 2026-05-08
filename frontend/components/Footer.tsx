/**
 * Global footer rendered from the root layout. Attribution to BIfactory
 * (the team behind Slotly). Links to bifactory.cz; the logo is the black
 * variant — wrapped in a white background pill so it stays readable on
 * dark mode (a white-on-black logo variant can replace it later).
 */

import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-zinc-200 bg-white py-5 px-4 dark:border-zinc-800 dark:bg-zinc-950 sm:px-6">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <span>Powered by</span>
        <Link
          href="https://bifactory.cz"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-200 dark:hover:text-white"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/bifactory-logo.png"
            alt="BIfactory"
            className="h-6 w-6 dark:hidden"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/bifactory-logo-white.png"
            alt="BIfactory"
            className="hidden h-6 w-6 dark:block"
          />
          <span>BIfactory s.r.o.</span>
        </Link>
      </div>
    </footer>
  );
}
