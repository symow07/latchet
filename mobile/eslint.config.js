// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const pluginQuery = require("@tanstack/eslint-plugin-query");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      "**/dist/**",
      "**/backend/generated/**",
      "**/backend/prisma/**",
      "backend/generated/**",
      "backend/prisma/**",
      "backend/node_modules/**",
      "backend/src/generated/**",
      "**/node_modules/**",
      "node_modules/**",
      "**/.expo/**",
      ".expo/**",
      "**/.expo-shared/**",
      ".expo-shared/**",
      "**/patches/**",
      "patches/**",
      "bun.lock",
      "eslint.config.js",
      "nativewind-env.d.ts",
      "rootStore.example.ts",
    ],
    settings: {
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: "./tsconfig.json",
        },
      },
    },
    rules: {
      // Formatting nits the sorter doesn't fix
      "comma-spacing": ["warn", { before: false, after: true }],
      // React recommended rules (only those not already covered by expo config)
      "react/jsx-no-undef": "error",
      "react/jsx-uses-react": "off", // React 17+ JSX transform
      "react/react-in-jsx-scope": "off",

      // Enforce React Hooks rules
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // React Hooks 7 (eslint-config-expo 56) adds the React Compiler's checks.
      // These five flag 32 places written before them, mostly setState in an
      // effect. Off until those are rewritten on their own; the other new
      // checks stay on.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "react-hooks/static-components": "off",
      "react-hooks/purity": "off",
      "react-hooks/use-memo": "off",

      "react/no-unescaped-entities": "off",
    },
  },
  ...pluginQuery.configs["flat/recommended"],
]);
