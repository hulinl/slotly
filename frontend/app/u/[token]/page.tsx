"use client";

/**
 * Public availability page — anyone with the link sees this read-only view.
 * Token is in the URL; backend gates on share_enabled and returns 404
 * otherwise. No nav, no auth required, OG tags for nice link previews.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Globe } from "lucide-react";
import { BookingDialog, type BookingSubmit } from "@/components/BookingDialog";
import { Logo } from "@/components/Logo";
import { SlotsCalendar } from "@/components/SlotsCalendar";
import { createPublicMeeting } from "@/lib/google";
import {
  colorFromName,
  computeFreeSlots,
  getInitials,
  getPublicProfile,
  PublicProfileNotFoundError,
  workingHoursRangeFromHours,
  type PublicProfileResponse,
} from "@/lib/public-profile";

export default function PublicProfilePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [data, setData] = useState<PublicProfileResponse | null>(null);
  const [error, setError] = useState<"not_found" | "load" | null>(null);

  const [bookingInterval, setBookingInterval] = useState<{ start: Date; end: Date } | null>(null);
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [bookingSuccess, setBookingSuccess] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await getPublicProfile(token);
        if (alive) setData(r);
      } catch (err) {
        if (!alive) return;
        if (err instanceof PublicProfileNotFoundError) {
          setError("not_found");
        } else {
          setError("load");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const slots = useMemo(() => {
    if (!data) return [];
    const start = new Date(data.window.start);
    const end = new Date(data.window.end);
    const free = computeFreeSlots(data.profile.working_hours, data.busy, start, end);
    return free.map((f) => ({ start: f.start, end: f.end }));
  }, [data]);

  const holidayMap = useMemo(() => {
    if (!data) return new Map<string, string>();
    return new Map(data.holidays.map((h) => [h.date, h.name]));
  }, [data]);

  if (error === "not_found") {
    return (
      <main className="grid min-h-screen place-items-center bg-zinc-50 px-6 dark:bg-zinc-950">
        <div className="mx-auto max-w-md text-center">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            Profile not found
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            This link is invalid or no longer public.
          </p>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="grid min-h-screen place-items-center bg-zinc-50 dark:bg-zinc-950">
        <div className="text-sm text-zinc-500">Loading…</div>
      </main>
    );
  }

  const { display_name, avatar_url, country } = data.profile;
  const initials = getInitials(display_name);
  const bgColor = colorFromName(display_name);

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Top brand bar — same Slotly mark as the authed app, so visitors know
          immediately whose service is showing them this page. */}
      <div className="border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center text-sm hover:opacity-80"
            aria-label="Slotly home"
          >
            <Logo size={20} />
          </Link>
          <Link
            href="/auth/register"
            className="text-xs font-medium text-zinc-500 hover:text-indigo-600 dark:text-zinc-400 dark:hover:text-indigo-400"
          >
            Get your own
          </Link>
        </div>
      </div>
      <header className="border-b border-zinc-200 bg-white py-10 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-3xl items-center gap-5 px-6">
          {avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatar_url}
              alt={display_name}
              className="h-20 w-20 shrink-0 rounded-full object-cover ring-2 ring-zinc-200 dark:ring-zinc-700"
            />
          ) : (
            <div
              className="grid h-20 w-20 shrink-0 place-items-center rounded-full text-2xl font-semibold text-white ring-2 ring-zinc-200 dark:ring-zinc-700"
              style={{ backgroundColor: bgColor }}
              aria-hidden
            >
              {initials}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {display_name}
            </h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
              <Globe className="h-4 w-4" />
              <span>{country}</span>
              <span aria-hidden>·</span>
              <span>Availability for the next 8 weeks</span>
            </p>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-8">
        {slots.length === 0 ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            No free time in the upcoming weeks.
          </div>
        ) : (
          <>
            {data.booking_enabled === false && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
                <p className="font-medium">
                  {display_name} isn&apos;t accepting direct bookings yet.
                </p>
                <p className="mt-1 text-amber-800 dark:text-amber-200/80">
                  You can still see their availability below — reach out
                  another way to arrange a time.
                </p>
              </div>
            )}
            <SlotsCalendar
              slots={slots}
              durationMin={30}
              holidays={holidayMap}
              workingHoursRange={workingHoursRangeFromHours(data.profile.working_hours)}
              onIntervalClick={
                data.booking_enabled === false
                  ? undefined
                  : (iv) => {
                      setBookingError(null);
                      setBookingSuccess(null);
                      setBookingInterval(iv);
                    }
              }
            />
          </>
        )}
      </section>

      <BookingDialog
        open={bookingInterval !== null}
        onClose={() => setBookingInterval(null)}
        interval={bookingInterval}
        mode="public"
        hostName={display_name}
        defaultTitle={`Meeting with ${display_name}`}
        allowPhysical
        submitting={bookingSubmitting}
        errorMessage={bookingError}
        successMessage={bookingSuccess}
        onSubmit={async (v: BookingSubmit) => {
          setBookingSubmitting(true);
          setBookingError(null);
          setBookingSuccess(null);
          try {
            const result = await createPublicMeeting({
              token,
              visitorName: v.visitorName ?? "",
              visitorEmail: v.visitorEmail ?? "",
              start: v.startIso,
              end: v.endIso,
              title: v.title,
              notes: v.notes,
              kind: v.kind,
              location: v.location,
            });
            if ("pending" in result && result.pending) {
              setBookingSuccess(
                `Request sent. ${display_name} will confirm or decline — you'll get an email either way.`,
              );
            } else {
              setBookingSuccess("Booked. Check your inbox for the invite.");
            }
            setTimeout(() => {
              setBookingInterval(null);
              setBookingSuccess(null);
              // Re-fetch so the just-booked window shows up as busy.
              getPublicProfile(token).then(setData).catch(() => {});
            }, 2200);
          } catch (err) {
            setBookingError(err instanceof Error ? err.message : "Couldn't create meeting");
          } finally {
            setBookingSubmitting(false);
          }
        }}
      />
    </main>
  );
}
