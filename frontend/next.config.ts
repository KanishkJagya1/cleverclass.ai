import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  images: {
    // AVIF first, WebP fallback. Covers are the heaviest asset on the site.
    formats: ["image/avif", "image/webp"],
    deviceSizes: [360, 480, 640, 768, 1024, 1280, 1536],
    imageSizes: [80, 120, 160, 200, 260, 320, 420],
    remotePatterns: [
      { protocol: "https", hostname: "kohinoortez.com" },
      { protocol: "https", hostname: "images.kohinoortez.com" },
    ],
  },

  experimental: {
    // Tree-shake barrel imports from these packages — lucide-react alone
    // pulls ~1400 modules without this.
    optimizePackageImports: ["lucide-react", "motion", "@radix-ui/react-icons"],
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        // Fonts are immutable and self-hosted via next/font.
        source: "/fonts/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },

  async rewrites() {
    // Proxy the FastAPI backend so the browser never needs CORS or a second
    // origin. In production this points at the container on the same host.
    const api = process.env.CATALOG_API_URL ?? process.env.BACKEND_URL ?? "http://localhost:8000";
    return [
      { source: "/api/ai/:path*", destination: `${api}/:path*` },
      // The admin API rides the same origin ON PURPOSE. Its session is an
      // HttpOnly cookie, and a cookie set by a different origin would need CORS
      // with credentials, a second cookie domain, and SameSite=None — i.e. the
      // exact configuration that makes CSRF easy. Same-origin keeps
      // SameSite=Lax meaningful. Next's rewrite passes Set-Cookie through in
      // both directions.
      { source: "/admin-api/:path*", destination: `${api}/admin-api/:path*` },
      // Preview page images (Phase 8) are served by the backend, which enforces
      // the free-page ranges. Routed here so the storage origin is never
      // exposed to the browser.
      { source: "/preview/:path*", destination: `${api}/preview/:path*` },
    ];
  },
};

export default nextConfig;
