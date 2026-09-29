import type { NextConfig } from "next";

const projectDir = process.cwd();

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: projectDir,
  turbopack: {
    root: projectDir,
  },
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    // CI 不安装 eslint（减小部署包体积），构建时跳过 lint
    ignoreDuringBuilds: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
