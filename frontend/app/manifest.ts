import type { MetadataRoute } from "next";

/**
 * PWA manifest. Next.js exposes this at `/manifest.webmanifest` and
 * automatically links it from <head> when the file lives at app/manifest.ts.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Slotly — find time to meet",
    short_name: "Slotly",
    description:
      "Subscribe to your team's calendars and instantly see when everyone is free.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#4f46e5",
    theme_color: "#4f46e5",
    categories: ["productivity", "business"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
