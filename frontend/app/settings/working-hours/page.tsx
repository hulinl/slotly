"use client";

/**
 * /settings/working-hours — own dedicated tab for the per-weekday
 * default availability windows. Pulled out of /settings so the tabbed
 * Settings IA can show one section per page.
 */

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AuthedHeader } from "@/components/AuthedHeader";
import { BackButton } from "@/components/BackButton";
import { SettingsNav } from "@/components/SettingsNav";
import { CardSkeleton, PageSkeleton } from "@/components/Skeleton";
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

export default function WorkingHoursSettingsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session.meta?.is_authenticated) {
        router.replace("/auth/login");
        return;
      }
      setMe(await getMe());
    })().catch(() => router.replace("/auth/login"));
  }, [router]);

  if (!me) {
    return (
      <PageSkeleton>
        <CardSkeleton rows={7} />
      </PageSkeleton>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <AuthedHeader email={me.email} />
      <main className="mx-auto max-w-2xl space-y-6 px-6 py-10">
        <BackButton fallback="/settings" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Working hours
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Your default availability for each day. Slot search will only suggest times in these windows.
          </p>
        </div>
        <SettingsNav />
        <WorkingHoursCard me={me} onSaved={setMe} />
      </main>
    </div>
  );
}

function WorkingHoursCard({ me, onSaved }: { me: Me; onSaved: (m: Me) => void }) {
  const [hours, setHours] = useState(me.working_hours);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const dirty = useMemo(
    () => JSON.stringify(hours) !== JSON.stringify(me.working_hours),
    [hours, me.working_hours],
  );

  function setDay(
    day: Weekday,
    patch: Partial<{ start: string; end: string; available: boolean }>,
  ) {
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
    <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <form onSubmit={onSubmit} className="space-y-3">
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {WEEKDAYS.map((day) => {
            const row = hours[day];
            return (
              <li key={day} className="flex items-center gap-3 py-3">
                <span className="w-24 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {DAY_LABEL[day]}
                </span>
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
    </section>
  );
}
