// metro.config.js
// Standalone Expo + NativeWind + SVG configuration (no platform SDK).
// SVG imports are handled by react-native-svg-transformer; `.svg` is moved from
// assetExts to sourceExts in the resolver below.

const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");
const fs = require("fs");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Only configure shared folder if it exists (may not exist during Docker build)
const sharedFolder = path.resolve(__dirname, "../shared");
const sharedFolderExists = fs.existsSync(sharedFolder);

// DEBUG: Log metro.config.js version and shared folder status at startup
console.log("[Metro Config] Version: 2025-02-03-v3-fix-dynamic-imports (source: workspace-mobile)");
console.log(`[Metro Config] Shared folder: ${sharedFolder}`);
console.log(`[Metro Config] Shared folder exists: ${sharedFolderExists}`);

if (sharedFolderExists) {
  config.watchFolders = [sharedFolder];
}

// Disable Watchman for file watching.
config.resolver.useWatchman = false;

// Configure asset and source extensions.
const { assetExts, sourceExts } = config.resolver;

// Transform .svg files into React components (replaces the platform SDK's
// bundled transformer). react-native-svg-transformer is a direct dependency.
config.transformer = {
  ...config.transformer,
  babelTransformerPath: require.resolve("react-native-svg-transformer"),
  getTransformOptions: async () => ({
    transform: {
      experimentalImportSupport: false,
      inlineRequires: true,
    },
  }),
};

// Configure resolver with SVG support, shared folder resolution, and web platform mocking
config.resolver = {
  ...config.resolver,
  assetExts: assetExts.filter((ext) => ext !== "svg"),
  sourceExts: [...sourceExts, "svg"],
  useWatchman: false,
  // Only add shared folder resolution if it exists
  // NOTE: unstable_enablePackageExports moved inside conditional - it breaks dynamic imports
  // like `await import("expo-image")` when enabled globally
  ...(sharedFolderExists && {
    unstable_enablePackageExports: true,
    extraNodeModules: {
      ...config.resolver.extraNodeModules,
      "@/shared": sharedFolder,
    },
    nodeModulesPaths: [
      path.resolve(__dirname, "node_modules"),
      path.resolve(__dirname, "../backend/node_modules"),
    ],
  }),
  resolveRequest: (context, moduleName, platform) => {
    // Handle @/shared/* imports explicitly
    // This is needed because:
    // 1. extraNodeModules alone doesn't handle subpath resolution
    // 2. Babel alias would transform to relative path which fails for nested files
    if (sharedFolderExists && moduleName.startsWith("@/shared/")) {
      const subpath = moduleName.slice("@/shared/".length);
      const resolvedPath = path.join(sharedFolder, subpath);
      console.log(`[Metro Resolve] @/shared alias: ${moduleName} -> ${resolvedPath}`);
      return context.resolveRequest(context, resolvedPath, platform);
    }

    // Also handle exact @/shared import (without subpath)
    if (sharedFolderExists && moduleName === "@/shared") {
      console.log(`[Metro Resolve] @/shared exact: ${moduleName} -> ${sharedFolder}`);
      return context.resolveRequest(context, sharedFolder, platform);
    }

    // Handle relative ../shared/* imports (fallback for unmigrated legacy code)
    // These imports are incorrect (resolve to wrong location) but we redirect them
    // to the actual shared folder for backwards compatibility
    // IMPORTANT: Only apply to user code, NOT node_modules (e.g., better-auth has its own internal shared/)
    if (sharedFolderExists && !context.originModulePath?.includes("node_modules")) {
      const relativeSharedMatch = moduleName.match(/^(?:\.\.\/)+shared\/(.+)$/);
      if (relativeSharedMatch) {
        const subpath = relativeSharedMatch[1];
        const resolvedPath = path.join(sharedFolder, subpath);
        console.log(`[Metro Resolve] RELATIVE SHARED: ${moduleName} -> ${resolvedPath}`);
        return context.resolveRequest(context, resolvedPath, platform);
      }
    }

    // Fix better-auth ESM resolution: Metro resolves to .cjs but package only ships .mjs
    // Intercept .cjs paths and redirect to .mjs
    if (moduleName.includes("better-auth") && moduleName.endsWith(".cjs")) {
      const mjsPath = moduleName.replace(/\.cjs$/, ".mjs");
      return context.resolveRequest(context, mjsPath, platform);
    }

    // Defensive: mock dev-time metro-config imports if any client code accidentally
    // pulls them in. Originally this also caught "async-require" in the OR clause,
    // but @expo/metro-config/build/async-require.js IS the runtime helper Metro
    // injects for every dynamic `import()` — replacing it with an empty object
    // produced "TypeError: require(...async-require.js) is not a function (it is
    // Object)" because the bundle calls the resolved module as a function. The
    // explicit !async-require exclusion lets the real helper resolve normally.
    if (
      moduleName.includes("@expo/metro-config") &&
      !moduleName.includes("async-require")
    ) {
      return { type: "empty" };
    }

    // Mock native-only modules on web
    if (platform === "web") {
      const nativeOnlyModules = [
        "react-native-pager-view",
        "reanimated-tab-view",
        "@bottom-tabs/react-navigation",
      ];

      if (nativeOnlyModules.some((mod) => moduleName.includes(mod))) {
        return {
          type: "empty",
        };
      }
    }

    // Fallback to default resolution
    return context.resolveRequest(context, moduleName, platform);
  },
};

// Integrate NativeWind with the Metro configuration.
module.exports = withNativeWind(config, { input: "./global.css" });
