import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/login", destination: "/?login=1", permanent: false },
      { source: "/signin", destination: "/?login=1", permanent: false },
      { source: "/register", destination: "/?login=1", permanent: false },
      { source: "/accounts/:path*", destination: "/settings", permanent: true },
    ];
  },
  turbopack: {
    root: process.cwd(),
  },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
};

export default nextConfig;
