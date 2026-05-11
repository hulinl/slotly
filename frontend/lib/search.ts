/** Client for POST /api/search. */

export type Slot = { start: string; end: string };

export type SearchInput = {
  team_id: number;
  member_ids: number[];
  duration_min: number;
  window_start?: string;
  window_end?: string;
  buffer_min?: number;
  /** Max slots returned. Default 100 (search results card); the profile
   * widget visualizing 8 weeks needs more (≈ 2000). Server caps at 5000. */
  limit?: number;
};

export type SearchResult = {
  slots: Slot[];
  count: number;
  truncated: boolean;
  /** [startHour, endHour] across the working hours of all selected members.
   * The calendar uses this to keep the time axis stable across searches
   * regardless of where slots happen to land. */
  working_hours_range: [number, number] | null;
};

export class SearchApiError extends Error {
  status: number;
  fields: Record<string, unknown>;
  constructor(status: number, fields: Record<string, unknown>) {
    const message =
      typeof fields.detail === "string" ? fields.detail : `Search failed (${status})`;
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

function csrfHeader(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const m = document.cookie.match(/(?:^|; )csrftoken=([^;]*)/);
  return m ? { "X-CSRFToken": decodeURIComponent(m[1]) } : {};
}

export async function searchSlots(input: SearchInput): Promise<SearchResult> {
  const res = await fetch("/api/search", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new SearchApiError(res.status, body);
  return body as SearchResult;
}

// ---------------------------------------------------------------------------
// Check-time mode: 'is everyone free at this specific time?'
// ---------------------------------------------------------------------------

export type CheckTimeInput = {
  team_id: number;
  member_ids: number[];
  start: string; // ISO
  end: string;   // ISO
};

export type CheckTimePerson = {
  user_id: number;
  first_name: string;
  last_name: string;
  email: string;
  status: "free" | "busy";
  conflicts: Slot[];
};

export type CheckTimeResult = {
  everyone_free: boolean;
  people: CheckTimePerson[];
};

export async function checkTime(input: CheckTimeInput): Promise<CheckTimeResult> {
  const res = await fetch("/api/search/check-time", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new SearchApiError(res.status, body);
  return body as CheckTimeResult;
}
