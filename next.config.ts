import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: { qualities: [65, 75], deviceSizes: [360, 480, 640, 750, 828, 1080, 1200, 1440, 1920] },
  async headers() {
    return [
      {
        // Avatar spritesheet: versioned by replacement, safe to cache hard.
        source: "/assets/avatar/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};
export default nextConfig;
