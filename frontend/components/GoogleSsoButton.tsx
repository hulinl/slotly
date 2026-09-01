"use client";

/**
 * "Sign in / up with Google" button. Anchors directly to the backend's
 * OAuth-start URL with `?anon=1`, letting Django redirect the top-level
 * browser to Google. Doing a full page navigation (not fetch) is required
 * so the cookie set by our callback rides back to the frontend on the
 * return trip.
 */

export function GoogleSsoButton({ label }: { label: string }) {
  return (
    <a
      href="/api/oauth/google/start?anon=1"
      className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white text-sm font-medium text-zinc-800 shadow-sm transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
    >
      <GoogleMark />
      {label}
    </a>
  );
}

export function MicrosoftSsoButton({ label }: { label: string }) {
  return (
    <a
      href="/api/oauth/microsoft/start?anon=1"
      className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white text-sm font-medium text-zinc-800 shadow-sm transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
    >
      <MicrosoftMark />
      {label}
    </a>
  );
}

export function SsoButtons({ verb }: { verb: "Sign in" | "Sign up" }) {
  return (
    <div className="space-y-2">
      <GoogleSsoButton label={`${verb} with Google`} />
      <MicrosoftSsoButton label={`${verb} with Microsoft`} />
    </div>
  );
}

export function OrSeparator() {
  return (
    <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
      <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
      or
      <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden>
      <path fill="#4285F4" d="M44 24c0-1.6-.1-2.8-.5-4.1H24v7.7h11.4c-.5 2.8-2.1 5.2-4.5 6.8v5.6h7.3c4.3-3.9 6.8-9.7 6.8-16z" />
      <path fill="#34A853" d="M24 44c6.2 0 11.4-2 15.2-5.6l-7.3-5.6c-2 1.4-4.6 2.3-7.9 2.3-6 0-11.1-4.1-12.9-9.5H3.5v6c3.8 7.5 11.6 12.4 20.5 12.4z" />
      <path fill="#FBBC05" d="M11.1 25.6c-.5-1.4-.7-2.9-.7-4.6s.3-3.2.7-4.6v-6H3.5C1.8 13.7 1 17 1 20.5s.8 6.8 2.5 9.6l7.6-4.5z" />
      <path fill="#EA4335" d="M24 8.6c3.4 0 6.4 1.2 8.8 3.5l6.6-6.6C35.4 2 30.2 0 24 0 15.1 0 7.3 5 3.5 12.4l7.6 6c1.8-5.4 6.9-9.5 12.9-9.5z" />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <rect x="1" y="1" width="10" height="10" fill="#F25022" />
      <rect x="13" y="1" width="10" height="10" fill="#7FBA00" />
      <rect x="1" y="13" width="10" height="10" fill="#00A4EF" />
      <rect x="13" y="13" width="10" height="10" fill="#FFB900" />
    </svg>
  );
}
