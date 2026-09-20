import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ExcelJS is a heavy CommonJS Node library — keep it out of the bundler.
  serverExternalPackages: ["exceljs"],
};

export default nextConfig;
