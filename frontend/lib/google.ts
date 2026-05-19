/**
 * Client for the Google Calendar connection endpoints (M18a).
 *
 * The OAuth flow itself is server-side: the frontend just navigates the
 * browser to /api/oauth/google/start, Google handles consent, and the
 * callback redirects back to /settings/integrations?google=<status>.
 * The functions here only read/clear the resulting GoogleAccount row.
 */

export type GoogleAccountStatus =
  | { connected: false }
  | { connected: true; google_email: string };

function csrfHeader(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const m = document.cookie.match(/(?:^|; )csrftoken=([^;]*)/);
  return m ? { "X-CSRFToken": decodeURIComponent(m[1]) } : {};
}

export async function getGoogleAccount(): Promise<GoogleAccountStatus> {
  const res = await fetch("/api/google-account", { credentials: "include" });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return (await res.json()) as GoogleAccountStatus;
}

export async function disconnectGoogleAccount(): Promise<void> {
  const res = await fetch("/api/google-account", {
    method: "DELETE",
    credentials: "include",
    headers: { ...csrfHeader() },
  });
  if (!res.ok) throw new Error(`status ${res.status}`);
}

/** Absolute URL we navigate the top-level browser to. The backend issues a
 * 302 to Google's consent screen, then bounces back here. */
export const GOOGLE_CONNECT_URL = "/api/oauth/google/start";
