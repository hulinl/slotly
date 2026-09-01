import Link from "next/link";
import { Logo } from "@/components/Logo";

export const metadata = {
  title: "Terms of Service — Slotly",
  description:
    "The terms under which you may use Slotly.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
          <Link href="/" aria-label="Slotly home">
            <Logo size={22} />
          </Link>
          <Link
            href="/privacy"
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Privacy
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">Terms of Service</h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Effective 1 September 2026 · Last updated 1 September 2026
        </p>

        <div className="prose prose-zinc mt-8 max-w-none space-y-6 text-[15px] leading-relaxed dark:prose-invert">
          <section>
            <h2 className="text-xl font-semibold">1. What Slotly is</h2>
            <p>
              Slotly is a scheduling service that lets you share your calendar
              availability with others and lets those others book meetings with you.
              It is operated by <strong>bifactory s.r.o.</strong> ("we", "us"), a
              Czech company reachable at{" "}
              <a className="underline" href="mailto:hulin@bifactory.cz">
                hulin@bifactory.cz
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">2. Accounts</h2>
            <p>
              You need an account to use Slotly. You may create it with email + password
              or by signing in with Google or Microsoft. You are responsible for keeping
              your credentials safe and for the actions taken on your account. Slotly is
              intended for users aged 16 or older.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">3. Acceptable use</h2>
            <p>
              Please don&apos;t use Slotly to send spam, phish, harass others, or scrape
              other users&apos; data. Don&apos;t try to break, overload, or reverse-engineer
              the service. We may suspend accounts that do — usually after warning, unless
              the abuse is ongoing.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">4. Your content</h2>
            <p>
              You keep ownership of everything you put into Slotly — profile details,
              meeting titles, notes, calendar connections. You grant us only the license
              needed to run the service on your behalf (store, process, transmit).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">5. Third-party services</h2>
            <p>
              When you connect Google or Microsoft, or embed a published ICS calendar
              URL, your use of those providers is governed by their own terms. Slotly is
              not responsible for downtime, data loss, or policy changes on their end.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">6. Availability</h2>
            <p>
              We aim to keep Slotly available and reliable but do not guarantee uptime.
              We may occasionally take the service offline for maintenance or upgrades.
              We&apos;ll do our best to warn you in advance when the outage is planned.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">7. No warranty, limited liability</h2>
            <p>
              Slotly is provided "as is". To the extent allowed by Czech law, we exclude
              implied warranties and limit our aggregate liability to the fees you paid
              us in the twelve months before the claim (or 100 EUR if you use Slotly
              free of charge).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">8. Ending the service</h2>
            <p>
              You can delete your account any time from Settings → Account → Delete
              account. We may terminate your account for material breach of these terms
              — usually after notice. On termination, your data is deleted per our{" "}
              <Link href="/privacy" className="underline">
                Privacy Policy
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">9. Changes</h2>
            <p>
              We may update these terms. Material changes will be communicated by email
              to active users at least 14 days before they take effect. Continued use
              after that means you accept the update.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">10. Law &amp; disputes</h2>
            <p>
              These terms are governed by the laws of the Czech Republic. Disputes fall
              under the exclusive jurisdiction of the Czech courts. If you&apos;re a
              consumer in the EU, you can also lodge a complaint via the European
              Commission&apos;s{" "}
              <a
                className="underline"
                href="https://ec.europa.eu/consumers/odr/"
                target="_blank"
                rel="noreferrer"
              >
                ODR platform
              </a>
              .
            </p>
          </section>
        </div>

        <footer className="mt-10 border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <p>
            Questions? Email{" "}
            <a className="underline" href="mailto:hulin@bifactory.cz">
              hulin@bifactory.cz
            </a>
            .
          </p>
        </footer>
      </main>
    </div>
  );
}
