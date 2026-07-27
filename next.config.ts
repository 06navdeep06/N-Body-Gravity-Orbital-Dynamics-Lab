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
 *
 * Static export: the app is entirely client-side (no server components doing
 * work, no route handlers, no server-side data fetching), so it exports to
 * plain files and can be served from GitHub Pages. `basePath` comes from the
 * environment because a Pages project site is served from
 * `/<repo>`, not the domain root — without it every asset URL 404s.
 */

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  // Trailing slashes make directory-style static hosting resolve
  // `/foo` to `/foo/index.html` reliably.
  trailingSlash: true,
  // No next/image is used, but the export target rejects the default
  // optimizer outright, so disable it explicitly.
  images: { unoptimized: true },
  // Source maps in production: this is a physics app people will want to
  // debug, and the bundle is already large enough that the extra files are
  // not the deciding cost.
  productionBrowserSourceMaps: true,
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
