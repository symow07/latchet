const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Sentry's config plugin (@sentry/react-native in app.json) makes the Xcode
 * "Bundle React Native code and images" phase run through sentry-cli, which
 * uploads the source maps, and adds an "Upload Debug Symbols to Sentry" phase.
 * Without SENTRY_ORG / SENTRY_AUTH_TOKEN sentry-cli fails *before* it bundles
 * ("An organization ID or slug is required"), so every build without them —
 * a local `expo run:ios`, a Release device build, an EAS build before the owner
 * has set the secrets — fails, Debug included.
 *
 * Both Sentry scripts skip the upload when SENTRY_DISABLE_AUTO_UPLOAD=true, and
 * both source ios/.xcode.env first. This appends a guard there that sets it
 * only when no auth token is present, so a build with the EAS secret uploads
 * and a build without it still bundles and succeeds. Re-applied on every
 * prebuild (ios/ is generated, never edited by hand).
 */
const MARK = "# [withSentryOptionalUpload]";
const GUARD = `
${MARK} Upload source maps and debug symbols to Sentry only when a token is
# present (the SENTRY_AUTH_TOKEN EAS secret); without one, skip the upload
# instead of failing the build.
if [ -z "$SENTRY_AUTH_TOKEN" ]; then
  export SENTRY_DISABLE_AUTO_UPLOAD=true
fi
`;

module.exports = function withSentryOptionalUpload(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, ".xcode.env");
      const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      if (!text.includes(MARK)) fs.writeFileSync(file, text.replace(/\n*$/, "\n") + GUARD);
      return cfg;
    },
  ]);
};
