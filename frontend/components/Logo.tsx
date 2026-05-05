/** Slotly logo mark — indigo rounded square with the "S" wordmark. */

export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-lg bg-indigo-600 font-bold text-white shadow-sm"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.6),
        lineHeight: 1,
      }}
    >
      S
    </span>
  );
}

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark size={size} />
      <span className="font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Slotly
      </span>
    </span>
  );
}
