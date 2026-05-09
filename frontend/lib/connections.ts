/** Client for /api/connections — bilateral peer connections (M22). */

export type ConnectionPeer = {
  id: number;
  email: string;
  display_name: string;
  avatar_url: string | null;
};

export type ConnectionStatus = "pending" | "accepted";

/** "incoming" — caller is the receiver of a pending request (offer Accept / Reject)
 *  "outgoing" — caller sent a pending request (offer Cancel)
 *  "accepted" — already connected. */
export type ConnectionDirection = "incoming" | "outgoing" | "accepted";

export type Connection = {
  id: number;
  status: ConnectionStatus;
  direction: ConnectionDirection;
  peer: ConnectionPeer | null;
  created_at: string;
  accepted_at: string | null;
};

export class ConnectionsApiError extends Error {
  status: number;
  payload: Record<string, unknown>;
  constructor(status: number, payload: Record<string, unknown>) {
    super(typeof payload.detail === "string" ? payload.detail : `HTTP ${status}`);
    this.status = status;
    this.payload = payload;
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
  if (!res.ok) throw new ConnectionsApiError(res.status, body);
  return body as T;
}

export const listConnections = () => request<Connection[]>("/api/connections");

export const requestConnection = (email: string) =>
  request<Connection>("/api/connections/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });

export const acceptConnection = (id: number) =>
  request<Connection>(`/api/connections/${id}/accept`, { method: "POST" });

export const rejectConnection = (id: number) =>
  request<void>(`/api/connections/${id}/reject`, { method: "POST" });

export const removeConnection = (id: number) =>
  request<void>(`/api/connections/${id}`, { method: "DELETE" });
