import { test, expect } from "bun:test";
import {
  visibilityRaisedNotification,
  normalizeNotifyLocale,
  NOTIFY_LOCALES,
} from "./household-notify";

test("every supported locale renders a title and body", () => {
  for (const locale of NOTIFY_LOCALES) {
    const { title, body } = visibilityRaisedNotification(locale, "Sam", "full");
    expect(title.length).toBeGreaterThan(0);
    expect(body).toContain("Sam");
    // No untranslated key or placeholder leaked through.
    expect(body).not.toContain("undefined");
    expect(body).not.toContain("${");
  }
});

test("the body says what changed, never the internal level name", () => {
  // "full" tells a recipient nothing about what they can now see. Checked per
  // level against its OWN identifier — the English wording for `full` contains
  // the word "categories" as ordinary prose, which is not a leak.
  for (const locale of NOTIFY_LOCALES) {
    for (const level of ["summary", "categories", "full"]) {
      const { body } = visibilityRaisedNotification(locale, "Sam", level);
      expect(body).not.toMatch(new RegExp(`\\b${level}\\b`));
    }
  }
});

test("each locale is actually distinct, not English four times", () => {
  const bodies = NOTIFY_LOCALES.map(
    (l) => visibilityRaisedNotification(l, "Sam", "categories").body
  );
  expect(new Set(bodies).size).toBe(NOTIFY_LOCALES.length);
});

test("an unknown locale falls back to English rather than rendering a key", () => {
  for (const junk of [null, undefined, "", "de", "EN", 5, {}]) {
    const { title, body } = visibilityRaisedNotification(junk, "Sam", "full");
    expect(title).toBe("Household visibility changed");
    expect(body).toContain("Sam");
  }
  expect(normalizeNotifyLocale("ar")).toBe("ar");
});

test("an unknown share level falls back to the least revealing wording", () => {
  // Failing towards "totals only" understates rather than overstates what the
  // group can see, which is the safe direction for a message about privacy.
  const { body } = visibilityRaisedNotification("en", "Sam", "nonsense");
  expect(body).toContain("totals only");
});
