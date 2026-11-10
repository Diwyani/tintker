import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the project root (a stray lockfile higher up would otherwise be picked).
  turbopack: { root: __dirname },
};

export default nextConfig;
