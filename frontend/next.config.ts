import type { NextConfig } from "next";

// Backend Django origin. Override via NEXT_PUBLIC_API_BASE_URL in .env if needed.
const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  /**
   * Reverse-proxy Django endpoints under the same origin as the Next.js app.
   * This makes Django's session + CSRF cookies same-origin from the browser's
   * perspective, sidestepping `SameSite=Lax` cross-origin restrictions in dev.
   */
  async rewrites() {
    return [
      { source: "/_allauth/:path*", destination: `${API}/_allauth/:path*` },
      { source: "/api/:path*", destination: `${API}/api/:path*` },
      { source: "/healthz", destination: `${API}/healthz` },
    ];
  },
};

export default nextConfig;
