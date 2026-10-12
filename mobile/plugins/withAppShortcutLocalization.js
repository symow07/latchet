const { withXcodeProject, IOSConfig } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Localises the Siri phrases and the intents' own text.
 *
 * Siri does not translate anything at runtime. Phrases are matched from the
 * strings compiled into the app binary's App Intents metadata, so a French
 * user saying "Ajouter une dépense dans Budget" only works if that phrase was
 * built in. The app itself is translated in JavaScript; this is the half of the
 * app that JavaScript cannot reach.
 *
 * Two tables, because Apple splits them:
 *   AppShortcuts  — the spoken phrases and the short titles in Shortcuts.
 *   Localizable   — everything a LocalizedStringResource resolves: intent
 *                   titles, descriptions, parameter names and prompts, and the
 *                   spoken confirmation.
 *
 * A .lproj per language rather than a String Catalog. The catalog is one file
 * instead of three and would have been less work, but Xcode rejects it:
 * "AppShortcuts.xcstrings is only supported for iOS 17.0 and above". This app
 * deploys to 15.1, and dropping iOS 15 and 16 users to save two files is not a
 * trade worth making.
 *
 * That means PBXVariantGroups, which the xcode library has no helper for, so
 * they are assembled by hand below.
 */
const SOURCE_DIR = path.join("plugins", "ios", "Localization");
const TABLES = ["AppShortcuts.strings", "Localizable.strings"];

/**
 * The locales the app ships, as iOS names them.
 *
 * "zh-Hans" rather than "zh": src/lib/i18n ships Simplified Chinese, and iOS
 * expects the script to be explicit. Keep in step with SUPPORTED_LOCALES.
 */
const REGIONS = ["en", "fr", "zh-Hans"];

module.exports = function withAppShortcutLocalization(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const projectRoot = cfg.modRequest.projectRoot;
    const platformRoot = cfg.modRequest.platformProjectRoot;
    const groupName = IOSConfig.XcodeUtils.getProjectName(projectRoot);

    const objects = project.hash.project.objects;
    objects.PBXVariantGroup = objects.PBXVariantGroup || {};

    for (const table of TABLES) {
      // Prebuild reruns this. A second variant group for the same table gives
      // duplicate resources and an ambiguous lookup at runtime.
      const linked = Object.entries(objects.PBXVariantGroup).some(
        ([key, group]) => !key.endsWith("_comment") && group?.name === table,
      );
      if (linked) continue;

      const children = [];
      for (const region of REGIONS) {
        const relative = path.join(`${region}.lproj`, table);
        const from = path.join(projectRoot, SOURCE_DIR, relative);
        if (!fs.existsSync(from)) {
          throw new Error(`[withAppShortcutLocalization] missing ${SOURCE_DIR}/${relative}`);
        }
        const to = path.join(platformRoot, groupName, relative);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);

        // One file reference per language, named for the language — that name
        // is what Xcode shows and what the build uses to pick the .lproj.
        //
        // The path is prefixed with the group name because this group carries a
        // name but no path of its own, so "<group>" resolves to ios/ and every
        // sibling spells out "Budget/..." for itself.
        const fileRef = project.generateUuid();
        objects.PBXFileReference[fileRef] = {
          isa: "PBXFileReference",
          lastKnownFileType: "text.plist.strings",
          name: region.includes("-") ? `"${region}"` : region,
          path: `"${path.join(groupName, relative)}"`,
          sourceTree: '"<group>"',
        };
        objects.PBXFileReference[`${fileRef}_comment`] = region;
        children.push({ value: fileRef, comment: region });
      }

      const variantGroup = project.generateUuid();
      objects.PBXVariantGroup[variantGroup] = {
        isa: "PBXVariantGroup",
        children,
        name: table,
        sourceTree: '"<group>"',
      };
      objects.PBXVariantGroup[`${variantGroup}_comment`] = table;

      // The build file points at the variant group, not at any one language.
      const buildFile = project.generateUuid();
      objects.PBXBuildFile[buildFile] = { isa: "PBXBuildFile", fileRef: variantGroup };
      objects.PBXBuildFile[`${buildFile}_comment`] = `${table} in Resources`;

      // By key. Passed an object, the xcode library uses its `fileRef` as the
      // child; a variant group has none, so the group got an `undefined`
      // child, which CocoaPods warned about on every install and dropped.
      project.addToPbxGroup(variantGroup, project.findPBXGroupKey({ name: groupName }));
      project.pbxResourcesBuildPhaseObj(
        IOSConfig.XcodeUtils.getApplicationNativeTarget({ project, projectName: groupName }).uuid,
      ).files.push({ value: buildFile, comment: `${table} in Resources` });
    }

    // Without this the catalogs compile but the phrases are never read: the
    // metadata processor defaults LM_NO_APP_SHORTCUT_LOCALIZATION to YES and
    // passes --no-app-shortcuts-localization, extracting English only.
    const appTarget = IOSConfig.XcodeUtils.getApplicationNativeTarget({
      project,
      projectName: groupName,
    });
    // Resolved through the target's own configuration list rather than matched
    // on PRODUCT_NAME — the app target's is the literal "Budget", which is a
    // detail of the Expo template and not something to depend on.
    const listId = appTarget.target.buildConfigurationList;
    for (const configuration of IOSConfig.XcodeUtils.getBuildConfigurationsForListId(
      project,
      listId,
    )) {
      const [, entry] = configuration;
      if (entry?.buildSettings) entry.buildSettings.LM_NO_APP_SHORTCUT_LOCALIZATION = "NO";
    }

    // Xcode only compiles a catalog into the languages the project claims.
    const projectSection = project.getFirstProject().firstProject;
    const known = new Set((projectSection.knownRegions || []).map((r) => String(r)));
    for (const region of REGIONS) known.add(region);
    known.add("Base");
    projectSection.knownRegions = [...known];

    return cfg;
  });
};
