import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["192.168.1.49", "192.168.100.208"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "erpdurallanta.provedatos.com" },
      {
        protocol: "https",
        hostname: "durallanta.com",
        pathname: "/durallantaoutlet/productos/**",
      },
    ],
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
