// Next.js settings for the web app.
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the dev indicator away from the sidebar's Settings link
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
