import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactCompiler: true,
  poweredByHeader: false,
  // Cache Components stays off on purpose: every screen is per-user and holds patient data,
  // so nothing is prerendered or cached across requests.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Nobody can frame the app and trick a reviewer into clicking Approve (clickjacking).
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Case URLs never leak to other sites through the Referer header.
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
};

export default nextConfig;
