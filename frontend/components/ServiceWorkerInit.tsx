"use client";

import { useEffect } from "react";

/**
 * Registers our minimal service worker once the app is hydrated. We skip dev
 * because Next's dev server replaces assets on hot reload, and a stale SW
 * cache makes that miserable.
 */
export function ServiceWorkerInit() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* registration failures are non-fatal */
    });
  }, []);
  return null;
}
