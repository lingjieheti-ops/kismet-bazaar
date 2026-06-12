import type { NextConfig } from "next";

// Static export: the ledger is a flat artifact that deploys anywhere.
// All data arrives client-side from raw.githubusercontent.com.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
