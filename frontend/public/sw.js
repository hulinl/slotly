// Slotly service worker — minimal shell caching.
// Strategy: network-first for HTML; bypass entirely for the API and the
// allauth endpoints (cookies + freshness must always go to the network).

const VERSION = "slotly-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL).catch(() => {})),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;
  // Never intercept dynamic backend traffic — cookies + auth must always be
  // fresh from the network.
  if (path.startsWith("/api/") || path.startsWith("/_allauth/") || path === "/healthz") {
    return;
  }

  // Network-first, fall back to cache if offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((m) => m || caches.match("/"))),
  );
});
