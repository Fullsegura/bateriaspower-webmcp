import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["192.168.1.49", "192.168.100.208"],
  images: {
    localPatterns: [{ pathname: "/products/bateriasecuador/**" }],
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
