/**
 * Domain wrappers around allauth-headless browser endpoints.
 * Reference: https://docs.allauth.org/en/latest/headless/openapi-specification/
 */

import { api, type AllauthResponse } from "./api";

const BASE = "/_allauth/browser/v1";

type SessionMeta = { is_authenticated: boolean };

export type SessionPayload = {
  user?: { id: number; email: string; display: string };
  flows?: Array<{ id: string; is_pending?: boolean }>;
};

export async function getSession(): Promise<AllauthResponse<SessionPayload>> {
  return api<SessionPayload>(`${BASE}/auth/session`);
}

export async function getConfig(): Promise<AllauthResponse> {
  return api(`${BASE}/config`);
}

export async function signup(email: string, password: string) {
  return api<SessionPayload>(`${BASE}/auth/signup`, {
    method: "POST",
    body: { email, password },
  });
}

export async function login(email: string, password: string) {
  return api<SessionPayload>(`${BASE}/auth/login`, {
    method: "POST",
    body: { email, password },
  });
}

export async function logout(): Promise<AllauthResponse> {
  return api(`${BASE}/auth/session`, { method: "DELETE" });
}

export async function confirmEmail(key: string) {
  return api<SessionPayload>(`${BASE}/auth/email/verify`, {
    method: "POST",
    body: { key },
  });
}

export async function requestPasswordReset(email: string) {
  return api(`${BASE}/auth/password/request`, {
    method: "POST",
    body: { email },
  });
}

export async function resetPassword(key: string, password: string) {
  return api(`${BASE}/auth/password/reset`, {
    method: "POST",
    body: { key, password },
  });
}

/** Return true if the user has a fully authenticated session. */
export function isAuthed(meta?: SessionMeta) {
  return meta?.is_authenticated === true;
}

/** Detect whether the response indicates verify_email is the next step. */
export function needsEmailVerification(res: AllauthResponse<SessionPayload>) {
  return Boolean(
    res.data?.flows?.some((f) => f.id === "verify_email" && f.is_pending),
  );
}
