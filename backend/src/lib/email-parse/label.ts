/**
 * A short, non-identifying remnant of a subject for display: every token that
 * carries a digit goes (order numbers, invoice references, amounts, dates), as
 * do addresses, links and currency signs. At most 60 characters, cut on a
 * word boundary where the script has spaces.
 */

const MAX = 60;

export function subjectLabel(subject: string, maxLength = MAX): string {
  let s = (subject ?? "").normalize("NFC");
  s = s
    .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
    .replace(/(?<![\w.+-])[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/g, " ")
    // Any run containing a digit (Latin, Arabic-Indic or full-width) with the Latin
    // characters attached to it, and a CJK date or money unit right after it.
    .replace(/[#№]?[A-Za-z0-9_\-./:,'’]*\p{Nd}[A-Za-z0-9_\-./:,'’\p{Nd}]*[年月日号元円]?/gu, " ")
    .replace(/[$£€¥￥₹₩₺₽¢]|(?<![\p{L}])(?:USD|EUR|GBP|CNY|RMB|MAD|DH|Dhs)(?![\p{L}])/gu, " ")
    .replace(/[\s\u00a0\u202f]+/g, " ")
    .replace(/(?:^[\s\-–—:,.|·•()[\]]+)|(?:[\s\-–—:,.|·•([]+$)/g, "")
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .trim();
  if (s.length <= maxLength) return s;
  const cut = s.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxLength / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s\-–—:,.|]+$/, "").trim();
}
