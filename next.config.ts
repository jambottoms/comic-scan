import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Ensure ffmpeg-static binary is included in server bundle
      config.externals = config.externals || [];
      // Don't externalize ffmpeg-static - we need the binary
    }
    return config;
  },
};

export default nextConfig;