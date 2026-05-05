/**
 * Client for the Calendar resource. Talks to DRF directly with manual CSRF.
 */

export type CalendarStatus = "ok" | "syncing" | "sync_failing" | "unreachable";
export type CalendarProvider = "google" | "apple" | "outlook" | "other";

export type Calendar = {
  id: number;
  name: string;
  provider: CalendarProvider;
  include_in_busy: boolean;
  status: CalendarStatus;
  last_synced_at: string | null;
  last_error: string;
  consecutive_failures: number;
  created_at: string;
  /** Present on POST /api/calendars and POST /api/calendars/{id}/sync */
  sync?: {
    status_code: number;
    fetched: boolean;
    written: number;
    deleted?: number;
    notes?: string;
  };
};

export type CalendarCreateInput = {
  name: string;
  url: string;
  include_in_busy?: boolean;
};

export class CalendarApiError extends Error {
  status: number;
  fields: Record<string, unknown>;
  constructor(status: number, fields: Record<string, unknown>) {
    super(typeof fields.url === "string" ? fields.url : "Request failed");
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
  // 204 No Content (DELETE)
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new CalendarApiError(res.status, body);
  return body as T;
}

export function listCalendars(): Promise<Calendar[]> {
  return request<Calendar[]>("/api/calendars");
}

export function createCalendar(input: CalendarCreateInput): Promise<Calendar> {
  return request<Calendar>("/api/calendars", { method: "POST", body: JSON.stringify(input) });
}

export function deleteCalendar(id: number): Promise<void> {
  return request<void>(`/api/calendars/${id}`, { method: "DELETE" });
}

export function syncCalendar(id: number): Promise<Calendar> {
  return request<Calendar>(`/api/calendars/${id}/sync`, { method: "POST" });
}

/** Force-refresh every calendar the caller owns. Async — calendars enter
 * "syncing" state and flip to OK / sync_failing when the worker finishes. */
export function syncAllMyCalendars(): Promise<{ queued: number }> {
  return request<{ queued: number }>(`/api/calendars/sync-all`, { method: "POST" });
}
