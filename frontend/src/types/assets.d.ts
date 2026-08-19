// Vite's `?url` imports return the emitted asset's URL. Declared here because
// the onnxruntime-web subpaths are not covered by vite/client's own types.
declare module "*.wasm?url" {
  const url: string;
  export default url;
}
declare module "*.mjs?url" {
  const url: string;
  export default url;
}
