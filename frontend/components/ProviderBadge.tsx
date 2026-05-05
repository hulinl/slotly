/** Single-letter colored badge for a calendar provider. Avoids using brand
 * trademarks while still giving the row visual identity at a glance. */

type Provider = "google" | "apple" | "outlook" | "other";

const STYLES: Record<Provider, { bg: string; letter: string }> = {
  google: {
    bg: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
    letter: "G",
  },
  apple: {
    bg: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
    letter: "A",
  },
  outlook: {
    bg: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
    letter: "O",
  },
  other: {
    bg: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300",
    letter: "ICS",
  },
};

export function ProviderBadge({ provider, size = 36 }: { provider: Provider; size?: number }) {
  const style = STYLES[provider] ?? STYLES.other;
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-lg font-semibold ${style.bg}`}
      style={{
        width: size,
        height: size,
        fontSize: style.letter.length > 1 ? Math.round(size * 0.32) : Math.round(size * 0.5),
      }}
    >
      {style.letter}
    </span>
  );
}
