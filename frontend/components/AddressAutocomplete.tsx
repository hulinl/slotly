"use client";

/**
 * Address input with type-ahead suggestions from OpenStreetMap Nominatim.
 *
 * Why Nominatim, not Google Places / Mapbox / HERE:
 *   - No API key or billing setup — Slotly ships to prod without another
 *     third-party bill or dashboard to manage. Users' picked address ends
 *     up in the calendar event's `location` field either way, so Google
 *     Calendar and Apple Calendar still generate their own Maps deep-link.
 *   - Terms of use require attribution ("Address search © OpenStreetMap
 *     contributors") which we render inline, plus a reasonable
 *     per-second request rate — the 350ms debounce plus 3-char minimum
 *     keeps us well under 1 req/s per user.
 *
 * If we ever need better address quality (e.g. small streets or corporate
 * campuses that Nominatim misses in some countries), swap this component's
 * fetch out for Google Places without touching the callers.
 */

import { useEffect, useRef, useState } from "react";
import { MapPin, Search } from "lucide-react";

type Suggestion = {
  place_id: number;
  display_name: string;
};

export function AddressAutocomplete({
  id,
  value,
  onChange,
  placeholder,
  required,
  autoFocus,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Set to true after the user picks a suggestion so we don't re-query
  // Nominatim with the address we just wrote back into the input.
  const skipNextFetch = useRef(false);

  useEffect(() => {
    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < 3) {
      setSuggestions([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=0&q=${encodeURIComponent(q)}`,
          { headers: { Accept: "application/json" } },
        );
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as Suggestion[];
        setSuggestions(data);
        setOpen(data.length > 0);
      } catch {
        setSuggestions([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [value]);

  // Close the suggestion dropdown when the user clicks outside the wrapper.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function pick(s: Suggestion) {
    skipNextFetch.current = true;
    onChange(s.display_name);
    setOpen(false);
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Search
          size={14}
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
        />
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true);
          }}
          placeholder={placeholder}
          required={required}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          className="flex h-10 w-full rounded-md border border-zinc-200 bg-white pl-8 pr-3 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-800 dark:bg-zinc-950 dark:placeholder:text-zinc-500"
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-zinc-400">
            …
          </span>
        )}
      </div>
      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {suggestions.map((s) => (
            <li key={s.place_id}>
              <button
                type="button"
                onClick={() => pick(s)}
                className="flex w-full items-start gap-2 border-b border-zinc-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
              >
                <MapPin size={14} aria-hidden className="mt-0.5 shrink-0 text-zinc-400" />
                <span className="min-w-0 flex-1 text-zinc-800 dark:text-zinc-100">
                  {s.display_name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">
        Address search ©{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
          className="underline decoration-dotted underline-offset-2"
        >
          OpenStreetMap
        </a>{" "}
        contributors
      </p>
    </div>
  );
}
