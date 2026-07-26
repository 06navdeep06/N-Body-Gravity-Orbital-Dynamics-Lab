import type { NextConfig } from "next";

/**
 * No custom worker bundling config needed: `lib/physics/physics.worker.ts`
 * is loaded via the native `new Worker(new URL("...", import.meta.url))`
 * pattern, which both Turbopack (Next.js 16's default bundler) and
 * webpack 5 handle out of the box.
 */
const nextConfig: NextConfig = {};

export default nextConfig;
