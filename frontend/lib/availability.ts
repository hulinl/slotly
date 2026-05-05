/** Client for /api/unavailabilities. */

export type Unavailability = {
  id: number;
  user_id: number;
  label: string;
  starts_at: string;
  ends_at: string;
  is_all_day: boolean;
  created_at: string;
  updated_at: string;
};

export type UnavailabilityInput = {
  label: string;
  starts_at: string;  // ISO datetime
  ends_at: string;    // ISO datetime, exclusive
  is_all_day?: boolean;
};

export class UnavailabilityApiError extends Error {
  status: number;
  fields: Record<string, unknown>;
  constructor(status: number, fields: Record<string, unknown>) {
    const m =
      typeof fields.detail === "string"
        ? fields.detail
        : Array.isArray(fields.label)
          ? String(fields.label[0])
          : Array.isArray(fields.ends_at)
            ? String(fields.ends_at[0])
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
  if (!res.ok) throw new UnavailabilityApiError(res.status, body);
  return body as T;
}

export const listUnavailabilities = (userId?: number) =>
  request<Unavailability[]>(
    userId ? `/api/unavailabilities?user_id=${userId}` : "/api/unavailabilities",
  );

export const createUnavailability = (input: UnavailabilityInput) =>
  request<Unavailability>("/api/unavailabilities", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const updateUnavailability = (id: number, patch: Partial<UnavailabilityInput>) =>
  request<Unavailability>(`/api/unavailabilities/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export const deleteUnavailability = (id: number) =>
  request<void>(`/api/unavailabilities/${id}`, { method: "DELETE" });
