import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El entorno de datos reales (scripts/reales.mjs) corre otra copia de la app al mismo tiempo: usa su propia carpeta
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
