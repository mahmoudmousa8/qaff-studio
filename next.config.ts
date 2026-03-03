import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,

  experimental: {
    // Increase body size for Server Actions
    serverActions: {
      bodySizeLimit: "100gb",
    },
  },
};

export default nextConfig;
