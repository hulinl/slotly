/** Client for /api/users (people graph) and /api/users/<id> (detail). */

import type { Connection } from "./connections";
import type { WorkingHours } from "./me";

export type Teammate = {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  working_hours: WorkingHours;
  country: string;
  shared_team_ids: number[];
};

export type Person = {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  shared_team_names: string[];
  connection_id: number | null;
};

export type PeopleGraph = {
  people: Person[];
  incoming: Connection[];
  outgoing: Connection[];
};

export class UsersApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function listPeople(): Promise<PeopleGraph> {
  const res = await fetch("/api/users", { credentials: "include" });
  if (!res.ok) throw new UsersApiError(res.status, `HTTP ${res.status}`);
  return res.json();
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
