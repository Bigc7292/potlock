import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@potlock/shared", "@potlock/db"],
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  webpack(webpackConfig) {
    // Workspace packages use NodeNext-style ".js" specifiers for their TypeScript sources.
    webpackConfig.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return webpackConfig;
  },
};

export default config;
