# Expo SDK 53 → 58 upgrade plan

_28 October 2026. A plan only: nothing is upgraded until you approve it._

## Why now

- **Xcode 27 removed `Simulator.app`.** It ships `DeviceHub.app` (`com.apple.dt.Devices`) instead; this Mac has Xcode 27.1 and no Simulator. SDK 53's Expo CLI (0.24) looks for a process called "Simulator", tries to open it, and gives up: "Simulator app did not open fast enough".
- **Apps built with the iOS 27 SDK need the UIScene life cycle.** Without it they crash at launch (SIGTRAP, "UIScene life cycle is required for apps built with this SDK"). Expo reproduced this on SDK 54. So patching the CLI is not enough: an SDK 53 app built with Xcode 27 is expected to crash even once it is installed.
- **Only SDK 58 handles both.** SDK 56 and later detect Device Hub. SDK 58 (15 October 2026) is built with the iOS 27 SDK and generates a `SceneDelegate`. Expo's maintainers say the fixes are not backported to SDK 54; "upgrade to SDK 58 to use Xcode 27".

## Step 0: keep working today (optional, about an hour, no code change)

Install **Xcode 26.4** next to Xcode 27, for example with `xcodes`, and point the command line at it while working on this app (`sudo xcode-select -s /Applications/Xcode-26.4.app`). Simulator.app comes back, and SDK 53 builds against the iOS 26 SDK, as it does today. The iOS 26.5 simulator runtime is already installed. There is 97 GB free and Xcode needs about 15 GB.

This is also what makes the step-by-step path below testable: SDKs 54 and 55 cannot run on Xcode 27 either. EAS builds are unaffected, because EAS picks its own Xcode per SDK.

## The path: five hops, each one tested before the next

Expo's advice is one SDK at a time, and to switch architectures on SDK 54 **before** SDK 55 removes the old one. This app runs on the **old architecture** today (`newArchEnabled: false`), so that switch is the largest single piece of work.

| Hop | What changes | Done when |
|---|---|---|
| **1. SDK 54** (RN 0.81), old architecture | `expo install expo@^54 --fix`. Point the 12 `expo-file-system` imports at `expo-file-system/legacy`. Sentry 6 → 7, Router 5 → 6, React 19.1. Reanimated stays on 3, which SDK 54 still allows. | Tests, typecheck and lint pass; a dev build runs every main screen on the iOS 26.5 simulator (Xcode 26) |
| **2. SDK 54, new architecture** | Remove `newArchEnabled: false`. Reanimated 3 → 4 plus `react-native-worklets`: the babel plugin becomes `react-native-worklets/plugin`, and 6 files use Reanimated. NativeWind 4.1 → 4.2 and drop both `overrides` pins (css-interop 0.1.22, Reanimated 3.17.4). Gesture Handler 2.28. Re-test the tab bar, the share extension, Siri intents, the RevenueCat paywall and Plaid's browser flow. | Same, plus a device build through EAS |
| **3. SDK 55** (RN 0.83) | The old architecture is gone for good. `expo-av` is removed (not used here: the app uses `expo-audio`). | Same |
| **4. SDK 56 → 57** (RN 0.85–0.86) | **Expo Router forks from React Navigation:** run `npx expo-codemod sdk-56-expo-router-react-navigation-replace src`. 7 files import `@react-navigation/*`: `useFocusEffect` ×5, the theme in `_layout.tsx`, and `BottomTabBarProps` in `LiquidTabBar.tsx`. **Minimum iOS 15.1 → 16.4** (`app.json`, read by `withIosDeploymentTarget` and the share extension); this drops iPhone 7, 6s and SE (1st gen). Hermes V1 becomes the default. Its memory regression with Reanimated is fixed in 57, so 56 and 57 go together. `File.copy()` and `move()` become async. | Same |
| **5. SDK 58** (RN 0.88, React 19.3) | UIScene: prebuild generates `SceneDelegate.swift`; none of our plugins edit `AppDelegate`, so they should carry over, but each must be checked. RN 0.88's strict TypeScript API: deep imports from `react-native/Libraries` are type errors; there are none in `src`, but our React Native patch is one (see Risks). Gesture Handler 3: its new hook API, with 2 gestures in `kit.tsx`. Sentry 8. Android release builds minify (R8) by default. Switch back to Xcode 27; Expo CLI then opens Device Hub itself. | The app runs on the iOS 27 simulator from Xcode 27 with `npx expo run:ios`, and an EAS preview build installs on your iPhone |

Each hop: one branch, `npx expo install expo@^N --fix`, `npx expo-doctor`, the 1,159 app tests (also under three time zones), typecheck, lint, a fresh dev build (`prebuild --clean`, then `pod install` with `LANG=en_US.UTF-8`), a walk through the main screens, then a commit. The backend is untouched.

## Libraries

| Package | Now | SDK 58 | What it means here |
|---|---|---|---|
| react-native | 0.79.6 | 0.88.0 | Four years' worth of RN in five steps: new architecture, Hermes V1, strict TypeScript API |
| expo-router | 5.1 | 58.0 | No longer built on React Navigation (hop 4); deterministic navigation state (hop 5) |
| react-native-reanimated | 3.17.4 (pinned) | 4.7.1 + worklets 0.13 | New architecture only. Same animation API; plugin and package split |
| react-native-gesture-handler | 2.24 | 3.3 | Hook-based API; 2 call sites |
| nativewind / css-interop | 4.1.23 / 0.1.22 (pinned) | 4.2.7 / 0.2.7 | **Needs a spike in hop 2**: confirm 4.2 with Reanimated 4. v5 is still a release candidate |
| @sentry/react-native | 6.14 | 8.28 | Two majors: Cocoa SDK 9, Sentry CLI 3, iOS 15+. Follow the 6→7 and 7→8 guides; `getSentryExpoConfig` stays |
| react-native-purchases (+ -ui) | 10.12.2 | 10.16.0 | Minor bump. RevenueCat publishes no statement on new-architecture support: test the paywall on a device |
| react-native-keyboard-controller | 1.19 | 1.22.7 | Minor |
| @react-native-community/datetimepicker | 8.4.1 | 9.2.1 | Major: check the props we use |
| react-native-screens / safe-area / svg | 4.11 / 5.4 / 15.11 | 4.30 / 5.10 / 15.16 | Aligned by `--fix` |
| expo-file-system | 18 (legacy API) | 58 | Hop 1 points imports at `/legacy`, which SDK 58 still ships. Moving to the new `File` API can wait |
| expo-notifications | 0.31 | 58.1 | Foreground display now defaults on; we already set a handler |
| expo-sqlite | 15.2 | 58.0 | libSQL removed (unused); blobs become `ArrayBuffer` |
| better-auth / @better-auth/expo | 1.x (patched 1.5.0) | 1.7.14 | Re-check whether our patch (the `node:module` import) is still needed |
| Plaid | none on the phone | — | Bank linking is Plaid Hosted Link in the system browser plus the backend. No native SDK, so nothing to upgrade; re-run the sandbox flow once |

## Risks, most likely first

1. **NativeWind on the new architecture and Reanimated 4.** Styling goes through it everywhere. If 4.2.7 misbehaves, the options are NativeWind 5 (still a release candidate) or pinning. The hop 2 spike decides.
2. **Our React Native patch** (`patches/react-native@0.79.6.patch`, 938 lines). It rewrites `ExceptionsManager.js` for a template's error overlay. It will not apply to 0.81+. Plan: drop it, since Sentry covers crash reporting. Confirm nothing depends on it.
3. **Custom native plugins.** The share extension (App Group), App Intents (Siri), `withIosDeploymentTarget`, `withFmtConstevalFix`, Sentry's optional upload and app-shortcut localisation. Each needs re-checking after `prebuild --clean` on each hop, and against the UIScene template in hop 5. `withFmtConstevalFix` may no longer be needed on newer React Native; remove it only if the build passes without it.
4. **RevenueCat's paywall (`react-native-purchases-ui`) on the new architecture.** Only a device purchase test proves it.
5. **The glass tab bar.** It uses `BlurView` and Reanimated worklets. Its geometry is tested, but the look needs a visual check. The new architecture also unlocks `expo-glass-effect`, which was impossible before (optional, later).
6. **iOS 16.4 minimum.** It drops a few old iPhones. Nobody is affected before launch.
7. **Android release builds** gain R8 minification in SDK 58. RevenueCat and Sentry ship their own keep rules, but a release build must be tried once.

## Estimate

- **My work:** about 4–6 working days in total. Hop 1 takes half a day, hop 2 (the architecture switch) 1.5–2 days, hop 3 half a day, hop 4 one day, hop 5 one day, and a final day for device builds, the Plaid sandbox run, the paywall and a full simulator walk-through.
- **Elapsed:** about 1–2 weeks, with your device checks after hops 2 and 5 and one EAS preview build each time.
- **What could stretch it:** the NativeWind spike, and anything the old React Native patch turns out to be holding up.

## What I need from you

1. **Approval to start**, on a branch, merged only after hop 5 passes, or hop by hop if you prefer.
2. **Whether to do step 0.** Installing Xcode 26.4 needs your Apple ID sign-in to download, so you do that part.
3. **Two device checks**, after hop 2 and after hop 5: purchase in the RevenueCat sandbox, the share sheet, Siri, Face ID and a notification.

## Sources

- [Expo SDK 58 changelog](https://expo.dev/changelog/sdk-58)
- [Expo SDK 56 changelog](https://expo.dev/changelog/sdk-56)
- [Expo SDK 54 changelog](https://expo.dev/changelog/sdk-54)
- [How to upgrade to Expo SDK 55](https://expo.dev/blog/upgrading-to-sdk-55)
- [Expo blog: Xcode 27 replaced Simulator.app](https://expo.dev/blog/xcode-27-device-hub-expo-device-hub)
- [expo/expo#46757: Device Hub support in Expo CLI](https://github.com/expo/expo/pull/46757)
- [expo/expo#52063: Xcode 27, Device Hub detection and the UIScene launch crash on SDK 54](https://github.com/expo/expo/issues/52063)
- [Gesture Handler 3](https://rec-ws.swmansion.com/blog/introducing-gesture-handler-3-0-hook-based-api-deeper-reanimated-integration-more-9185b0c8e305)
- [Sentry React Native: migrating from 7.x to 8.x](https://docs.sentry.io/platforms/react-native/migration/v7-to-v8/)
- [Reanimated compatibility table](https://docs.swmansion.com/react-native-reanimated/docs/guides/compatibility)
- Package versions: `bundledNativeModules.json` in `expo@58.0.20` and `expo@54.0.38` on npm.
