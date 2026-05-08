"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { Bell, Building2, CalendarDays, ChevronRight, ExternalLink, RefreshCw, UserCog, type LucideIcon } from "lucide-react";
import { AuthedHeader } from "@/components/AuthedHeader";
import { BackButton } from "@/components/BackButton";
import { CardSkeleton, PageSkeleton } from "@/components/Skeleton";
import { Button, FormError, FormSuccess, Input, Label } from "@/components/ui";
import { getSession } from "@/lib/auth";
import {
  getMe,
  patchMe,
  regenerateShareToken,
  uploadAvatar,
  type Me,
  type MePatch,
  type Weekday,
  WEEKDAYS,
  MeApiError,
  SUPPORTED_COUNTRIES,
} from "@/lib/me";
import { colorFromName, getInitials } from "@/lib/public-profile";

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
  return (
    <Suspense fallback={<PageSkeleton><CardSkeleton rows={3} /></PageSkeleton>}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cameFromProfile = searchParams.get("from") === "profile";
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
      <PageSkeleton>
        <CardSkeleton rows={3} />
        <CardSkeleton rows={7} className="mt-6" />
      </PageSkeleton>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <AuthedHeader email={me.email} />

      <main className="mx-auto max-w-2xl space-y-8 px-6 py-10">
        {cameFromProfile && <BackButton fallback="/profile" />}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Settings</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Update your profile and weekly availability.</p>
        </div>

        <ProfileCard me={me} onSaved={setMe} />
        <ShareCard me={me} onSaved={setMe} />
        <WorkingHoursCard me={me} onSaved={setMe} />

        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-3 text-base font-semibold text-zinc-900 dark:text-zinc-50">More</h2>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            <SettingsRow href="/settings/calendars" icon={CalendarDays} label="Calendar subscriptions" hint="Subscribe to ICS URLs you want Slotly to read" />
            <SettingsRow href="/settings/teams" icon={Building2} label="Teams & invitations" hint="Create teams, invite people, accept invites" />
            <SettingsRow href="/settings/notifications" icon={Bell} label="Notification preferences" hint="Choose which events email you and ring the bell" />
            <SettingsRow href="/settings/account" icon={UserCog} label="Account & deletion" hint="Delete your account permanently" destructive />
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
  const [country, setCountry] = useState(me.country || "CZ");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await patchMe({
        first_name: firstName,
        last_name: lastName,
        phone,
        country,
      });
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
        <div className="space-y-1.5">
          <Label htmlFor="country">Country</Label>
          <select
            id="country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-950"
          >
            {SUPPORTED_COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Drives public-holiday markers in the calendar grid.
          </p>
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
// Public profile share card (M17)
// ---------------------------------------------------------------------------

function ShareCard({ me, onSaved }: { me: Me; onSaved: (m: Me) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  const publicUrl =
    typeof window !== "undefined" && me.share_token
      ? `${window.location.origin}/u/${me.share_token}`
      : "";

  const displayName =
    `${me.first_name} ${me.last_name}`.trim() || me.email.split("@")[0];

  async function toggleEnabled() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await patchMe({ share_enabled: !me.share_enabled });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update");
    } finally {
      setBusy(false);
    }
  }

  async function copyUrl() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — copy can fail in non-secure contexts
    }
  }

  async function regenerate() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await regenerateShareToken();
      onSaved(updated);
      setConfirmRegen(false);
      setSuccess("New link generated. The old one stopped working.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't regenerate");
    } finally {
      setBusy(false);
    }
  }

  async function onAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Photo must be under 5 MB.");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await uploadAvatar(file);
      onSaved(updated);
      setSuccess("Photo updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  return (
    <Card
      title="Public profile"
      description="Share a link to your availability. Anyone with the URL can see your busy/free for 8 weeks — no event details, no contact info."
    >
      <div className="space-y-5">
        {/* Avatar */}
        <div className="flex items-center gap-4">
          {me.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={me.avatar_url}
              alt={displayName}
              className="h-16 w-16 shrink-0 rounded-full object-cover ring-2 ring-zinc-200 dark:ring-zinc-700"
            />
          ) : (
            <div
              className="grid h-16 w-16 shrink-0 place-items-center rounded-full text-lg font-semibold text-white ring-2 ring-zinc-200 dark:ring-zinc-700"
              style={{ backgroundColor: colorFromName(displayName) }}
              aria-hidden
            >
              {getInitials(displayName)}
            </div>
          )}
          <div>
            <Label htmlFor="avatar-upload">Profile photo</Label>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              JPG / PNG, up to 5 MB. Optional — we use your initials otherwise.
            </p>
            <input
              id="avatar-upload"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={onAvatarChange}
              disabled={busy}
              className="mt-2 block w-full max-w-xs text-sm file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100 dark:file:bg-indigo-950/40 dark:file:text-indigo-300"
            />
          </div>
        </div>

        {/* Toggle */}
        <div className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              Sharing is {me.share_enabled ? "ON" : "OFF"}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {me.share_enabled
                ? "Anyone with your link can view your availability."
                : "Your link returns 404 until you turn this on."}
            </p>
          </div>
          <Button
            type="button"
            onClick={toggleEnabled}
            disabled={busy}
            className={
              me.share_enabled
                ? "bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900"
                : "bg-indigo-600 hover:bg-indigo-700"
            }
          >
            {me.share_enabled ? "Turn off" : "Turn on"}
          </Button>
        </div>

        {/* Public URL block — only useful when sharing is on */}
        {me.share_enabled && (
          <div className="space-y-2">
            <Label>Your public link</Label>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={publicUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 font-mono text-xs"
              />
              <Button type="button" onClick={copyUrl} disabled={!publicUrl} className="!w-auto shrink-0 px-4">
                {copied ? "Copied!" : "Copy"}
              </Button>
            </div>
            <div className="flex flex-wrap gap-3 pt-1">
              <a
                href={publicUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Preview my profile
              </a>
              {!confirmRegen ? (
                <button
                  type="button"
                  onClick={() => setConfirmRegen(true)}
                  className="inline-flex items-center gap-1.5 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Generate new link
                </button>
              ) : (
                <span className="inline-flex items-center gap-2 text-sm">
                  <span className="text-zinc-700 dark:text-zinc-300">
                    This breaks the old link. Continue?
                  </span>
                  <button
                    type="button"
                    onClick={regenerate}
                    disabled={busy}
                    className="font-medium text-red-600 hover:underline dark:text-red-400"
                  >
                    Yes, regenerate
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmRegen(false)}
                    className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                  >
                    Cancel
                  </button>
                </span>
              )}
            </div>
          </div>
        )}

        <FormError message={error} />
        <FormSuccess message={success} />
      </div>
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

function SettingsRow({
  href,
  icon: Icon,
  label,
  hint,
  destructive = false,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  hint?: string;
  destructive?: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        className="group flex items-center gap-3 py-3 transition-colors hover:bg-zinc-50/60 dark:hover:bg-zinc-800/40"
      >
        <span
          className={
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg " +
            (destructive
              ? "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300"
              : "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300")
          }
        >
          <Icon size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{label}</p>
          {hint && (
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
          )}
        </div>
        <ChevronRight size={16} className="shrink-0 text-zinc-400 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}
