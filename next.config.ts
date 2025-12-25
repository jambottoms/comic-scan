import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
  },
  // External packages for server components (prevents bundling)
  serverExternalPackages: ['ffmpeg-static'],
  // Ensure FFmpeg binary is included in Vercel deployment
  outputFileTracingIncludes: {
    '/**': [
      'node_modules/ffmpeg-static/**/*',
    ],
  },
  // Turbopack config (Vercel uses Turbopack by default)
  // Note: FFmpeg binary is loaded at runtime via require(), not at build time
  turbopack: {},
  // Webpack config (for local builds and explicit webpack usage)
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Ignore ffmpeg-static binary file - it's loaded at runtime
      config.module = config.module || {};
      config.module.rules = config.module.rules || [];
      config.module.rules.push({
        test: /ffmpeg-static\/ffmpeg$/,
        type: 'asset/resource',
        generator: {
          emit: false, // Don't emit the binary file
        },
      });
      
      // Mark ffmpeg-static as external so webpack doesn't try to bundle it
      config.externals = config.externals || [];
      if (typeof config.externals === 'function') {
        const originalExternals = config.externals;
        config.externals = [
          originalExternals,
          (context: any, request: string, callback: any) => {
            if (request === 'ffmpeg-static' || request.includes('ffmpeg-static')) {
              return callback(null, 'commonjs ' + request);
            }
            if (typeof originalExternals === 'function') {
              originalExternals(context, request, callback);
            } else {
              callback();
            }
          },
        ];
      } else if (Array.isArray(config.externals)) {
        config.externals.push('ffmpeg-static');
      }
    }
    return config;
  },
};

export default nextConfig;