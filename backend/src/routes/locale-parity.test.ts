import { test, expect } from "bun:test";

/**
 * The backend's accepted locales must match the app's.
 *
 * A comment saying "keep these in sync" is already in settings.ts, and it did
 * not work: Arabic shipped in the app and the enum here kept rejecting it.
 * The failure is not a reset locale — zValidator rejects the whole body, so
 * every setting an Arabic user changed stopped syncing at once, silently.
 *
 * The same bug is recorded in settings.ts for primaryGoal, where two of the
 * four goals a user could tap 400'd on sync. Twice is a pattern, so this is a
 * test rather than a third comment.
 */
test("the settings locale enum matches the app's SUPPORTED_LOCALES", async () => {
  const core = await Bun.file(
    new URL("../../../mobile/src/lib/i18n/core.ts", import.meta.url)
  ).text();
  const appMatch = core.match(/SUPPORTED_LOCALES\s*=\s*\[([^\]]*)\]/);
  expect(appMatch).not.toBeNull();
  const appLocales = [...appMatch![1]!.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]!);
  expect(appLocales.length).toBeGreaterThan(1);

  const settings = await Bun.file(new URL("./settings.ts", import.meta.url)).text();
  const apiMatch = settings.match(/locale:\s*z\.enum\(\[([^\]]*)\]\)/);
  expect(apiMatch).not.toBeNull();
  const apiLocales = [...apiMatch![1]!.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]!);

  expect([...apiLocales].sort()).toEqual([...appLocales].sort());
});
