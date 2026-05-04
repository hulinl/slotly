/**
 * Client for /api/teams and /api/invitations.
 */

export type TeamRole = "admin" | "member";

export type TeamSummary = {
  id: number;
  name: string;
  description: string;
  member_count: number;
  my_role: TeamRole | null;
  created_at: string;
};

export type TeamMember = {
  user_id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: TeamRole;
  joined_at: string;
};

export type TeamInvitation = {
  id: number;
  invited_email: string;
  invited_by_email: string | null;
  status: "pending" | "accepted" | "rejected" | "cancelled" | "expired";
  role_on_accept: TeamRole;
  created_at: string;
  expires_at: string;
  is_active: boolean;
};

export type TeamDetail = TeamSummary & {
  members: TeamMember[];
  invitations: TeamInvitation[];
};

export type IncomingInvitation = {
  id: number;
  team_id: number;
  team_name: string;
  invited_by_email: string | null;
  role_on_accept: TeamRole;
  created_at: string;
  expires_at: string;
  token: string;
};

export class TeamsApiError extends Error {
  status: number;
  fields: Record<string, unknown>;
  constructor(status: number, fields: Record<string, unknown>) {
    const m =
      typeof fields.detail === "string"
        ? fields.detail
        : typeof fields.email === "string"
          ? fields.email
          : typeof fields.name === "string"
            ? fields.name
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
  if (!res.ok && res.status >= 300) {
    throw new TeamsApiError(res.status, body);
  }
  return body as T;
}

// --- Teams ---
export const listTeams = () => request<TeamSummary[]>("/api/teams");

export const getTeam = (id: number) => request<TeamDetail>(`/api/teams/${id}`);

export const createTeam = (input: { name: string; description?: string }) =>
  request<TeamSummary>("/api/teams", { method: "POST", body: JSON.stringify(input) });

export const updateTeam = (id: number, input: { name?: string; description?: string }) =>
  request<TeamSummary>(`/api/teams/${id}`, { method: "PATCH", body: JSON.stringify(input) });

export const deleteTeam = (id: number) =>
  request<void>(`/api/teams/${id}`, { method: "DELETE" });

export const leaveTeam = (id: number) =>
  request<{ detail: string }>(`/api/teams/${id}/leave`, { method: "POST" });

// --- Members ---
export const updateMemberRole = (teamId: number, userId: number, role: TeamRole) =>
  request<TeamMember>(`/api/teams/${teamId}/members/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });

export const removeMember = (teamId: number, userId: number) =>
  request<void>(`/api/teams/${teamId}/members/${userId}`, { method: "DELETE" });

// --- Invitations (admin) ---
export const inviteToTeam = (teamId: number, email: string, role: TeamRole = "member") =>
  request<{ detail: string; id: number }>(`/api/teams/${teamId}/invite`, {
    method: "POST",
    body: JSON.stringify({ email, role }),
  });

export const cancelInvitation = (teamId: number, invitationId: number) =>
  request<void>(`/api/teams/${teamId}/invitations/${invitationId}`, { method: "DELETE" });

export const resendInvitation = (teamId: number, invitationId: number) =>
  request<{ detail: string }>(`/api/teams/${teamId}/invitations/${invitationId}/resend`, {
    method: "POST",
  });

// --- Invitations (recipient) ---
export const listMyInvitations = () => request<IncomingInvitation[]>("/api/invitations");

export const acceptInvitation = (token: string) =>
  request<{ team_id: number; status: string }>(`/api/invitations/${token}/accept`, {
    method: "POST",
  });

export const rejectInvitation = (token: string) =>
  request<{ status: string }>(`/api/invitations/${token}/reject`, {
    method: "POST",
  });
