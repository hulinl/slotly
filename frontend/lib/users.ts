/** Client for /api/users/<id>. */

import type { WorkingHours } from "./me";

export type Teammate = {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  working_hours: WorkingHours;
  shared_team_ids: number[];
};

export class UsersApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function getTeammate(id: number): Promise<Teammate> {
  const res = await fetch(`/api/users/${id}`, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new UsersApiError(
      res.status,
      typeof body.detail === "string" ? body.detail : `HTTP ${res.status}`,
    );
  }
  return res.json();
}
