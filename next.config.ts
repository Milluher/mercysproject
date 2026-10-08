import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (the in-process Postgres used locally and in tests) ships WebAssembly that must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  poweredByHeader: false,
};

export default nextConfig;
