import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: { qualities: [65, 75], deviceSizes: [360, 480, 640, 750, 828, 1080, 1200, 1440, 1920] },
};
export default nextConfig;
