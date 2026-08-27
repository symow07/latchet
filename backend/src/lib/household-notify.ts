/**
 * The visibility-change notification, in the recipient's own language.
 *
 * The app ships in four languages, so a push that is always English is a
 * visible seam — and this particular push is one people are meant to read and
 * act on, which makes it a poor place to have one.
 *
 * The server can do this because UserSettings.locale is per user: the same
 * event goes to several recipients and each is rendered separately. Pure, so
 * the wording can be tested without a database or a push service.
 */

export const NOTIFY_LOCALES = ["en", "fr", "zh", "ar"] as const;
export type NotifyLocale = (typeof NOTIFY_LOCALES)[number];

/** Anything unrecognised falls back to English rather than rendering a key. */
export function normalizeNotifyLocale(value: unknown): NotifyLocale {
  return (NOTIFY_LOCALES as readonly string[]).includes(value as string)
    ? (value as NotifyLocale)
    : "en";
}

/**
 * What the recipient can now see, in plain language.
 *
 * Deliberately not the internal level name: "full" tells someone nothing
 * about what changed for them.
 */
const WORDING: Record<NotifyLocale, Record<string, string>> = {
  en: {
    summary: "totals only",
    categories: "totals and spending by category",
    full: "totals, categories and individual transactions",
  },
  fr: {
    summary: "les totaux uniquement",
    categories: "les totaux et les dépenses par catégorie",
    full: "les totaux, les catégories et chaque transaction",
  },
  zh: {
    summary: "仅总额",
    categories: "总额与各分类支出",
    full: "总额、分类以及每一笔交易",
  },
  ar: {
    summary: "الإجماليات فقط",
    categories: "الإجماليات والإنفاق حسب الفئة",
    full: "الإجماليات والفئات وكل معاملة على حدة",
  },
};

const TITLE: Record<NotifyLocale, string> = {
  en: "Household visibility changed",
  fr: "Visibilité du foyer modifiée",
  zh: "家庭组可见范围已更改",
  ar: "تغيّرت ظهورية الأسرة",
};

const BODY: Record<NotifyLocale, (who: string, what: string) => string> = {
  en: (who, what) => `${who} now shares ${what} with the household.`,
  fr: (who, what) => `${who} partage désormais ${what} avec le foyer.`,
  zh: (who, what) => `${who} 现在与家庭组共享${what}。`,
  ar: (who, what) => `${who} يشارك الآن ${what} مع الأسرة.`,
};

export function visibilityRaisedNotification(
  rawLocale: unknown,
  who: string,
  shareLevel: string
): { title: string; body: string } {
  const locale = normalizeNotifyLocale(rawLocale);
  const what = WORDING[locale][shareLevel] ?? WORDING[locale].summary!;
  return { title: TITLE[locale], body: BODY[locale](who, what) };
}
