/** Client for /api/holidays. Holidays are keyed by YYYY-MM-DD. */

export type HolidayEntry = { date: string; name: string };

export async function fetchHolidays(
  year: number,
  country?: string,
): Promise<Map<string, string>> {
  const qs = new URLSearchParams({ year: String(year) });
  if (country) qs.set("country", country);
  const res = await fetch(`/api/holidays?${qs.toString()}`, { credentials: "include" });
  if (!res.ok) return new Map();
  const body = (await res.json()) as { results: HolidayEntry[] };
  return new Map(body.results.map((h) => [h.date, h.name]));
}

/** Convenience: cover the spread of a date range with all relevant years. */
export async function fetchHolidaysForRange(
  fromISO: string,
  toISO: string,
  country?: string,
): Promise<Map<string, string>> {
  const fromYear = new Date(fromISO).getFullYear();
  const toYear = new Date(toISO).getFullYear();
  const years: number[] = [];
  for (let y = fromYear; y <= toYear; y++) years.push(y);
  const maps = await Promise.all(years.map((y) => fetchHolidays(y, country)));
  const merged = new Map<string, string>();
  for (const m of maps) for (const [k, v] of m) merged.set(k, v);
  return merged;
}
