/** raw-loader turns `.wgsl` imports into their source text (see next.config.ts). */
declare module "*.wgsl" {
  const source: string;
  export default source;
}
