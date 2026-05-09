/** Client for /api/notifications and /api/me/notification-prefs. */

export const NOTIFICATION_EVENTS = [
  "team.invitation_sent",
  "team.invitation_accepted",
  "team.invitation_rejected",
  "team.member_joined",
  "team.member_left",
  "team.member_removed",
  "team.role_promoted",
  "team.role_demoted",
  "team.deleted",
  "calendar.sync_failed",
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export type Notification = {
  id: number;
  type: NotificationEvent;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

export type NotificationsListResponse = {
  results: Notification[];
  unread_count: number;
};

export type NotificationPrefs = Record<NotificationEvent, { email: boolean; in_app: boolean }>;

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
  if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : `HTTP ${res.status}`);
  return body as T;
}

export const listNotifications = (unreadOnly = false) =>
  request<NotificationsListResponse>(
    unreadOnly ? "/api/notifications?unread=1" : "/api/notifications",
  );

export const markRead = (id: number) =>
  request<Notification>(`/api/notifications/${id}/read`, { method: "POST" });

export const markAllRead = () =>
  request<{ updated: number }>("/api/notifications/read-all", { method: "POST" });

export const getNotificationPrefs = () =>
  request<NotificationPrefs>("/api/me/notification-prefs");

export const patchNotificationPrefs = (patch: Partial<NotificationPrefs>) =>
  request<NotificationPrefs>("/api/me/notification-prefs", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

// ---------------------------------------------------------------------------
// Client-side renderer for notification text. Server stores type+payload only.
// ---------------------------------------------------------------------------

export type RenderedNotification = {
  text: string;
  href?: string;
};

export function renderNotification(n: Notification): RenderedNotification {
  const p = n.payload as {
    team_id?: number;
    team_name?: string;
    inviter_email?: string;
    accepter_email?: string;
    rejecter_email?: string;
    member_email?: string;
    calendar_name?: string;
  };
  const teamLink = p.team_id !== undefined ? `/groups/${p.team_id}` : undefined;
  switch (n.type) {
    case "team.invitation_sent":
      return {
        text: `${p.inviter_email ?? "Someone"} invited you to “${p.team_name ?? "a team"}”.`,
        href: "/groups",
      };
    case "team.invitation_accepted":
      return {
        text: `${p.accepter_email ?? "Someone"} accepted your invitation to “${p.team_name ?? "a team"}”.`,
        href: teamLink,
      };
    case "team.invitation_rejected":
      return {
        text: `${p.rejecter_email ?? "Someone"} declined your invitation to “${p.team_name ?? "a team"}”.`,
        href: teamLink,
      };
    case "team.member_joined":
      return {
        text: `${p.member_email ?? "A new member"} joined “${p.team_name ?? "a team"}”.`,
        href: teamLink,
      };
    case "team.member_left":
      return {
        text: `${p.member_email ?? "A member"} left “${p.team_name ?? "a team"}”.`,
        href: teamLink,
      };
    case "team.member_removed":
      return {
        text: `You were removed from “${p.team_name ?? "a team"}”.`,
      };
    case "team.role_promoted":
      return {
        text: `You're now an admin of “${p.team_name ?? "a team"}”.`,
        href: teamLink,
      };
    case "team.role_demoted":
      return {
        text: `You're no longer an admin of “${p.team_name ?? "a team"}”.`,
        href: teamLink,
      };
    case "team.deleted":
      return { text: `The team “${p.team_name ?? ""}” was deleted.` };
    case "calendar.sync_failed":
      return {
        text: `Calendar “${p.calendar_name ?? "(unknown)"}” hasn't synced for 24 h.`,
        href: "/settings/calendars",
      };
  }
}

export const EVENT_LABELS: Record<NotificationEvent, string> = {
  "team.invitation_sent": "You were invited to a team",
  "team.invitation_accepted": "Your invitation was accepted",
  "team.invitation_rejected": "Your invitation was declined",
  "team.member_joined": "A new member joined a team",
  "team.member_left": "A member left a team",
  "team.member_removed": "You were removed from a team",
  "team.role_promoted": "You were promoted to admin",
  "team.role_demoted": "You were demoted from admin",
  "team.deleted": "A team was deleted",
  "calendar.sync_failed": "A calendar's sync is failing",
};
