/** Client for /api/saved-searches and /api/recent-searches. */

export type SavedSearch = {
  id: number;
  name: string;
  team: number;
  member_ids: number[];
  duration_min: number;
  buffer_min: number;
  window_days: number;
  created_at: string;
  last_used_at: string;
};

export type SavedSearchInput = {
  name: string;
  team: number;
  member_ids: number[];
  duration_min: number;
  buffer_min: number;
  window_days: number;
};

export type RecentSearch = {
  id: number;
  team: number;
  member_ids: number[];
  duration_min: number;
  buffer_min: number;
  window_start: string;
  window_end: string;
  created_at: string;
};

export class SavedSearchApiError extends Error {
  status: number;
  fields: Record<string, unknown>;
  constructor(status: number, fields: Record<string, unknown>) {
    const m =
      typeof fields.detail === "string"
        ? fields.detail
        : Array.isArray(fields.name)
          ? String(fields.name[0])
          : Array.isArray(fields.member_ids)
            ? String(fields.member_ids[0])
            : `Request failed (${status})`;
    super(m);
    this.status = status;
    this.fields = fields;
  }
}

function csrfHeader(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const m = document.cookie.match(/(?:^|; )csrftoken=([^;]*)/);
  return m ? { "X-CSRFToken": decodeURIComponent(m[1]) } : {};
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...csrfHeader(),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new SavedSearchApiError(res.status, body);
  return body as T;
}

export const listSavedSearches = () => request<SavedSearch[]>("/api/saved-searches");

export const createSavedSearch = (input: SavedSearchInput) =>
  request<SavedSearch>("/api/saved-searches", { method: "POST", body: JSON.stringify(input) });

export const updateSavedSearch = (id: number, patch: Partial<SavedSearchInput>) =>
  request<SavedSearch>(`/api/saved-searches/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export const deleteSavedSearch = (id: number) =>
  request<void>(`/api/saved-searches/${id}`, { method: "DELETE" });

export const listRecentSearches = () => request<RecentSearch[]>("/api/recent-searches");

export const deleteRecentSearch = (id: number) =>
  request<void>(`/api/recent-searches/${id}`, { method: "DELETE" });
