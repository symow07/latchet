module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind", unstable_transformImportMeta: true }],
      "nativewind/babel",
    ],
    plugins: [
      [
        "module-resolver",
        {
          alias: {
            "@": "./src",
            "@/shared": "./shared",
            "better-auth/react": "./node_modules/better-auth/dist/client/react/index.cjs",
          },
        },
      ],
      "@babel/plugin-proposal-export-namespace-from",
      // No Reanimated plugin here: babel-preset-expo adds react-native-worklets/plugin
      // itself (SDK 54+), and listing it again would run it twice.
    ],
  };
};
