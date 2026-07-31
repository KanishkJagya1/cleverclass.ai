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
    // origin. In production this points at the Render/AWS deployment.
    const api = process.env.BACKEND_URL ?? "http://localhost:8000";
    return [{ source: "/api/ai/:path*", destination: `${api}/:path*` }];
  },
};

export default nextConfig;
