const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Xcode 16.3+ / 26 ship a Clang that treats fmt's FMT_STRING `consteval`
 * evaluation as a hard error, so the `fmt` pod (used by React Native's Folly)
 * fails to compile ("call to consteval function ... is not a constant
 * expression"). Defining FMT_USE_CONSTEVAL=0 makes fmt fall back to constexpr,
 * which compiles cleanly. Injected into the Podfile's post_install so every
 * pod target picks it up. Durable across `expo prebuild`.
 */
const MARKER = "FMT_USE_CONSTEVAL=0";
const SNIPPET = `
    # [withFmtConstevalFix] Xcode 16.3+/26 compatibility for the fmt pod.
    installer.pods_project.targets.each do |fmt_target|
      fmt_target.build_configurations.each do |fmt_config|
        defs = fmt_config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] || ['$(inherited)']
        defs = [defs] unless defs.is_a?(Array)
        defs << '${MARKER}' unless defs.include?('${MARKER}')
        fmt_config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] = defs
      end
    end
`;

module.exports = function withFmtConstevalFix(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, "Podfile");
      let contents = fs.readFileSync(podfile, "utf8");
      if (!contents.includes(MARKER)) {
        contents = contents.replace(
          /post_install do \|installer\|/,
          `post_install do |installer|\n${SNIPPET}`,
        );
        fs.writeFileSync(podfile, contents);
      }
      return cfg;
    },
  ]);
};
