import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "standalone",
  // Explicit workspace root — prevents Turbopack from inferring a wrong
  // root when parent directories contain package.json files (sandbox),
  // which produced "Next.js package not found" panics after reinstalls.
  turbopack: {
    root: path.join(__dirname),
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
