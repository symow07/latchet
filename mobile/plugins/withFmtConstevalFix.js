const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Xcode 16.3+ / 26 ship a Clang where fmt's FMT_STRING `consteval` path is a
 * hard error, so the `fmt` pod (used by React Native's Folly) fails to compile:
 * "call to consteval function ... is not a constant expression".
 *
 * A compiler -DFMT_USE_CONSTEVAL=0 does NOT help, because fmt's base.h
 * *unconditionally* redefines FMT_USE_CONSTEVAL (no #ifndef guard) and picks 1
 * for modern clang. So we patch base.h itself, forcing the `1` branches to `0`,
 * which makes FMT_CONSTEVAL expand to nothing (runtime format checks instead of
 * consteval). Runs in the Podfile post_install — after CocoaPods extracts fmt —
 * so it's reapplied on every `pod install` / `expo prebuild`.
 */
const SNIPPET = `
    # [withFmtConstevalFix] Force fmt consteval off (Xcode 16.3+/26 compatibility).
    fmt_base = File.join(installer.sandbox.root.to_s, 'fmt', 'include', 'fmt', 'base.h')
    if File.exist?(fmt_base)
      fmt_text = File.read(fmt_base)
      fmt_patched = fmt_text.gsub('define FMT_USE_CONSTEVAL 1', 'define FMT_USE_CONSTEVAL 0')
      File.write(fmt_base, fmt_patched) if fmt_patched != fmt_text
    end
`;

module.exports = function withFmtConstevalFix(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, "Podfile");
      let contents = fs.readFileSync(podfile, "utf8");
      if (!contents.includes("withFmtConstevalFix")) {
        // Insert just before the closing `end` of the post_install block so it
        // runs after react_native_post_install and after pods are on disk.
        contents = contents.replace(
          /(post_install do \|installer\|[\s\S]*?)(\n  end)/,
          `$1\n${SNIPPET}$2`,
        );
        fs.writeFileSync(podfile, contents);
      }
      return cfg;
    },
  ]);
};
