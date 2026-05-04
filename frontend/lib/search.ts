/** Client for POST /api/search. */

export type Slot = { start: string; end: string };

export type SearchInput = {
  team_id: number;
  member_ids: number[];
  duration_min: number;
  window_start?: string;
  window_end?: string;
  buffer_min?: number;
};

export type SearchResult = {
  slots: Slot[];
  count: number;
  truncated: boolean;
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
