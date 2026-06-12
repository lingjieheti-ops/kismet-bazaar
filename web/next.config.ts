import type { NextConfig } from "next";

// Static export: the ledger is a flat artifact that deploys anywhere.
// All data arrives client-side from raw.githubusercontent.com.
// NEXT_PUBLIC_BASE_PATH lets the same build serve from a sub-path
// (GitHub Pages project sites) or the root (Vercel, custom domain).
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  basePath,
  assetPrefix: basePath || undefined,
};

export default nextConfig;
