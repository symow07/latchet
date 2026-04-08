// Shim for node:module — used by @better-auth/expo's createRequire call.
// React Native doesn't support Node built-ins, so we provide a compatible shim.
// The only real usage in @better-auth/expo is: __require("expo-web-browser")
// which is handled by Metro's normal module resolution anyway.
export function createRequire(_url) {
  return function require(id) {
    // @better-auth/expo uses this for expo-web-browser dynamic require.
    // In React Native, Metro handles this statically — return empty so it doesn't crash.
    console.warn(`[node:module shim] require('${id}') called — returning empty module`);
    return {};
  };
}

export default { createRequire };
