const { withPodfile, withXcodeProject } = require("@expo/config-plugins");

/**
 * One iOS minimum version for the whole project — the app, every pod and the
 * share extension — from one place in app.json.
 *
 * The value is expo-build-properties' `ios.deploymentTarget`, the standard Expo
 * setting for it. That plugin writes it to Podfile.properties.json, which the
 * Podfile reads for `platform :ios`, so every pod resolves against it, and to
 * the app target. Three places it does not reach, all handled here:
 *
 *   - The project-level build settings and every non-application target keep
 *     the template's value. This plugin carries the configured one to every
 *     build configuration that sets one; withShareExtension reads it through
 *     iosDeploymentTarget() for the target it creates, so the result does not
 *     depend on which plugin's Xcode mod runs first.
 *   - Pod targets keep the minimum their own podspec declares (9.0, 12.4,
 *     13.0…). react_native_post_install lifts each pod's library target, but not
 *     its resource bundles, and Xcode 26 fails a device build on any target
 *     below iOS 15 ("the range of supported deployment target versions is 15.0
 *     to 27.0"): SDWebImage, RevenueCat, PurchasesHybridCommon, RevenueCatUI,
 *     RNCAsyncStorage and RNSVG all ship one. A post_install step lifts every
 *     pod target below the minimum up to it. Nothing is lowered.
 *
 * Why the value matters: Expo's autolinking leaves out any module whose podspec
 * needs a newer iOS than this, and says so only in `pod install --verbose`. The
 * install succeeds, the build succeeds, and the app throws "Cannot find native
 * module" at runtime. Raise the value in app.json, never in Xcode.
 */
const SOURCE = "expo-build-properties";
const MARKER = "[withIosDeploymentTarget]";

/** The configured iOS minimum version, as app.json spells it. */
function iosDeploymentTarget(config) {
  for (const entry of config.plugins ?? []) {
    const [name, props] = Array.isArray(entry) ? entry : [entry, undefined];
    const target = props?.ios?.deploymentTarget;
    if (name === SOURCE && target) return String(target);
  }
  throw new Error(
    `[withIosDeploymentTarget] app.json must set ios.deploymentTarget on the ${SOURCE} ` +
      "plugin: the app, its pods and the share extension all build against that one value.",
  );
}

// Reads the minimum the way the Podfile's own `platform :ios` line does, from
// Podfile.properties.json, which prebuild rewrites every run, so a changed
// value takes effect without this snippet being regenerated.
const POST_INSTALL = `
    # ${MARKER} No pod target below the app's iOS minimum, resource bundles
    # included: Xcode 26 fails a device build on any target below iOS 15.
    ios_minimum = Gem::Version.new(podfile_properties['ios.deploymentTarget'] || '16.4')
    installer.generated_projects.each do |project|
      project.targets.each do |pod_target|
        pod_target.build_configurations.each do |build_configuration|
          current = build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
          next if current.nil? || Gem::Version.new(current) >= ios_minimum
          build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = ios_minimum.to_s
        end
      end
    end
`;

function withIosDeploymentTarget(config) {
  config = withXcodeProject(config, (cfg) => {
    const target = iosDeploymentTarget(cfg);
    const section = cfg.modResults.pbxXCBuildConfigurationSection();
    for (const configuration of Object.values(section)) {
      const settings = typeof configuration === "object" ? configuration?.buildSettings : null;
      if (settings && settings.IPHONEOS_DEPLOYMENT_TARGET !== undefined) {
        settings.IPHONEOS_DEPLOYMENT_TARGET = target;
      }
    }
    return cfg;
  });

  return withPodfile(config, (cfg) => {
    const podfile = cfg.modResults.contents;
    if (podfile.includes(MARKER)) return cfg;
    // Just before the closing `end` of post_install, so it runs after
    // react_native_post_install has set the pods up.
    const patched = podfile.replace(
      /(post_install do \|installer\|[\s\S]*?)(\n  end)/,
      `$1\n${POST_INSTALL}$2`,
    );
    if (patched === podfile) {
      throw new Error(`${MARKER} could not find the Podfile's post_install block`);
    }
    cfg.modResults.contents = patched;
    return cfg;
  });
}

module.exports = withIosDeploymentTarget;
module.exports.iosDeploymentTarget = iosDeploymentTarget;
