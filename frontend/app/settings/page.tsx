"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AuthedHeader } from "@/components/AuthedHeader";
import { Button, FormError, FormSuccess, Input, Label } from "@/components/ui";
import { getSession } from "@/lib/auth";
import {
  getMe,
  patchMe,
  type Me,
  type MePatch,
  type Weekday,
  WEEKDAYS,
  MeApiError,
} from "@/lib/me";

const DAY_LABEL: Record<Weekday, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

type Status = "loading" | "ready" | "unauth";

export default function SettingsPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session.meta?.is_authenticated) {
        router.replace("/auth/login");
        setStatus("unauth");
        return;
      }
      const fetched = await getMe();
      setMe(fetched);
      setStatus("ready");
    })().catch(() => setStatus("unauth"));
  }, [router]);

  if (status !== "ready" || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <p className="text-sm text-zinc-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <AuthedHeader email={me.email} />

      <main className="mx-auto max-w-2xl space-y-8 px-6 py-10">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Settings</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Update your profile and weekly availability.</p>
        </div>

        <ProfileCard me={me} onSaved={setMe} />
        <WorkingHoursCard me={me} onSaved={setMe} />

        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-1 text-base font-semibold text-zinc-900 dark:text-zinc-50">More</h2>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            <li>
              <Link href="/settings/calendars" className="flex items-center justify-between py-3 text-sm hover:underline">
                <span>Calendar subscriptions</span>
                <span className="text-zinc-400">→</span>
              </Link>
            </li>
            <li>
              <Link href="/settings/teams" className="flex items-center justify-between py-3 text-sm hover:underline">
                <span>Teams &amp; invitations</span>
                <span className="text-zinc-400">→</span>
              </Link>
            </li>
            <li>
              <Link href="/settings/notifications" className="flex items-center justify-between py-3 text-sm hover:underline">
                <span>Notification preferences</span>
                <span className="text-zinc-400">→</span>
              </Link>
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile card
// ---------------------------------------------------------------------------

function ProfileCard({ me, onSaved }: { me: Me; onSaved: (m: Me) => void }) {
  const [firstName, setFirstName] = useState(me.first_name);
  const [lastName, setLastName] = useState(me.last_name);
  const [phone, setPhone] = useState(me.phone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await patchMe({ first_name: firstName, last_name: lastName, phone });
      onSaved(updated);
      setSuccess("Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Profile" description="Your name and phone — visible to people who share a team with you.">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="first_name">First name</Label>
            <Input id="first_name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="last_name">Last name</Label>
            <Input id="last_name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+420 ..."
          />
        </div>
        <FormError message={error} />
        <FormSuccess message={success} />
        <div className="pt-2">
          <Button type="submit" disabled={saving} className="sm:w-auto sm:px-6">
            {saving ? "Saving…" : "Save profile"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Working hours card
// ---------------------------------------------------------------------------

function WorkingHoursCard({ me, onSaved }: { me: Me; onSaved: (m: Me) => void }) {
  const [hours, setHours] = useState(me.working_hours);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // recompute dirty state to enable/disable Save
  const dirty = useMemo(
    () => JSON.stringify(hours) !== JSON.stringify(me.working_hours),
    [hours, me.working_hours],
  );

  function setDay(day: Weekday, patch: Partial<{ start: string; end: string; available: boolean }>) {
    setHours((h) => ({ ...h, [day]: { ...h[day], ...patch } }));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await patchMe({ working_hours: hours } as MePatch);
      onSaved(updated);
      setSuccess("Saved.");
    } catch (err) {
      if (err instanceof MeApiError && err.fields.working_hours) {
        const wh = err.fields.working_hours as Record<string, string>;
        const first = Object.entries(wh)[0];
        setError(first ? `${first[0]}: ${String(first[1])}` : "Invalid working hours");
      } else {
        setError(err instanceof Error ? err.message : "Save failed");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title="Working hours"
      description="Your default availability for each day of the week. Slot search will only suggest times within these windows."
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {WEEKDAYS.map((day) => {
            const row = hours[day];
            return (
              <li key={day} className="flex items-center gap-3 py-3">
                <span className="w-24 text-sm font-medium text-zinc-900 dark:text-zinc-50">{DAY_LABEL[day]}</span>
                <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                  <input
                    type="checkbox"
                    checked={row.available}
                    onChange={(e) => setDay(day, { available: e.target.checked })}
                    className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  Available
                </label>
                <div className="ml-auto flex items-center gap-2">
                  <Input
                    type="time"
                    value={row.start}
                    onChange={(e) => setDay(day, { start: e.target.value })}
                    disabled={!row.available}
                    className="w-28"
                  />
                  <span className="text-xs text-zinc-400">to</span>
                  <Input
                    type="time"
                    value={row.end}
                    onChange={(e) => setDay(day, { end: e.target.value })}
                    disabled={!row.available}
                    className="w-28"
                  />
                </div>
              </li>
            );
          })}
        </ul>
        <FormError message={error} />
        <FormSuccess message={success} />
        <div className="pt-2">
          <Button type="submit" disabled={!dirty || saving} className="sm:w-auto sm:px-6">
            {saving ? "Saving…" : "Save working hours"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Card shell
// ---------------------------------------------------------------------------

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <header className="mb-5">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">{description}</p>}
      </header>
      {children}
    </section>
  );
}
