/**
 * Client for the DRF /api/me endpoint. Returns plain DRF JSON (not the
 * allauth-headless envelope), so it talks to fetch directly with manual CSRF.
 */

export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export type DayHours = { start: string; end: string; available: boolean };

export type WorkingHours = Record<Weekday, DayHours>;

export type Me = {
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  working_hours: WorkingHours;
};

export type MePatch = Partial<Pick<Me, "first_name" | "last_name" | "phone" | "working_hours">>;

export type FieldErrors = Record<string, unknown>;

export class MeApiError extends Error {
  status: number;
  fields: FieldErrors;
  constructor(status: number, fields: FieldErrors) {
    super("Update failed");
    this.status = status;
    this.fields = fields;
  }
}

function csrfHeader(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const m = document.cookie.match(/(?:^|; )csrftoken=([^;]*)/);
  return m ? { "X-CSRFToken": decodeURIComponent(m[1]) } : {};
}

export async function getMe(): Promise<Me> {
  const res = await fetch("/api/me", { credentials: "include" });
  if (!res.ok) throw new MeApiError(res.status, await res.json().catch(() => ({})));
  return res.json();
}

export async function patchMe(patch: MePatch): Promise<Me> {
  const res = await fetch("/api/me", {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
    body: JSON.stringify(patch),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new MeApiError(res.status, body);
  return body as Me;
}

export type DeleteMePreview = {
  teams_member_count: number;
  teams_will_be_deleted: number;
  team_members_will_be_notified: number;
  calendars_count: number;
  cached_events_count: number;
  notifications_count: number;
};

export async function getDeleteMePreview(): Promise<DeleteMePreview> {
  const res = await fetch("/api/me/delete", { credentials: "include" });
  if (!res.ok) throw new MeApiError(res.status, await res.json().catch(() => ({})));
  return res.json();
}

export async function deleteMe(password: string): Promise<void> {
  const res = await fetch("/api/me/delete", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new MeApiError(res.status, await res.json().catch(() => ({})));
}
