import type { NextConfig } from "next";

/**
 * Worker bundling needs no custom config: `lib/physics/*.worker.ts` are
 * loaded via the native `new Worker(new URL("...", import.meta.url))`
 * pattern, which both Turbopack (Next.js 16's default bundler) and
 * webpack 5 handle out of the box.
 *
 * `.wgsl` does need a rule — Turbopack has no built-in module type for it,
 * so raw-loader turns the shader into an exported string while letting the
 * WGSL stay in a real `.wgsl` file (editor tooling, syntax highlighting).
 */
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.wgsl": {
        loaders: ["raw-loader"],
        as: "*.js",
      },
    },
  },
};

export default nextConfig;
