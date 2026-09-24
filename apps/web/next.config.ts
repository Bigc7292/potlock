import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@potlock/shared", "@potlock/db"],
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
};

export default config;
