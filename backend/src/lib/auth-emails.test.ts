import { describe, expect, test } from "bun:test";
import {
  APP_RESET_PASSWORD_URL,
  APP_VERIFY_EMAIL_URL,
  authEmailLocale,
  escapeHtml,
  passwordResetEmail,
  verificationEmail,
  pinAppCallback,
  withAppCallback,
} from "./auth-emails";

// Links as Better Auth builds them: the reset one with a path token and the
// verification one with a JWT and an "&" between its parameters, which is the
// character that has to be escaped inside an href.
const RESET_URL = "https://api.example.com/api/auth/reset-password/AbC123xyz?callbackURL=realbudget%3A%2F%2Freset-password";
const VERIFY_URL = "https://api.example.com/api/auth/verify-email?token=eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6ImFAYi5jIn0.sig&callbackURL=realbudget%3A%2F%2Fverify-email";

const lines = (s: string) => s.split("\n");

describe("auth emails", () => {
  test("the reset email carries the link in the HTML and, on a line of its own, in the plain text", () => {
    const mail = passwordResetEmail({ name: "Sam", url: RESET_URL, locale: "en" });
    expect(lines(mail.text)).toContain(RESET_URL);
    expect(mail.html).toContain(`href="${escapeHtml(RESET_URL)}"`);
    expect(mail.subject).toBe("Reset your Budget password");
    // Says what the link does to the other sessions, and that ignoring it is safe.
    expect(mail.text).toContain("signs you out");
    expect(mail.text).toContain("ignore this email");
  });

  test("the verification email carries the link in both bodies, its & escaped in the HTML", () => {
    const mail = verificationEmail({ name: "Sam", url: VERIFY_URL, locale: "en" });
    expect(lines(mail.text)).toContain(VERIFY_URL);
    expect(mail.html).toContain(`href="${VERIFY_URL.replace("&", "&amp;")}"`);
    // Every & in the HTML starts an entity: no raw one survives.
    expect(mail.html).not.toMatch(/&(?!amp;|lt;|gt;|quot;|#39;)/);
    expect(mail.subject).toBe("Confirm your email for Budget");
  });

  test("the user's name is HTML-escaped, and cannot add lines to the plain text", () => {
    const name = `<img src=x onerror="alert('x')"> & Co\nClick https://evil.example`;
    for (const mail of [
      passwordResetEmail({ name, url: RESET_URL, locale: "en" }),
      verificationEmail({ name, url: VERIFY_URL, locale: "fr" }),
    ]) {
      expect(mail.html).not.toContain("<img");
      expect(mail.html).not.toContain(`onerror="`);
      expect(mail.html).toContain("&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp; Co");
      // The newline is collapsed, so the injected URL does not stand on a line
      // of its own looking like the real link.
      expect(lines(mail.text)).not.toContain("Click https://evil.example");
    }
    // No name: a greeting without one, not "Hi ,".
    expect(passwordResetEmail({ name: "  ", url: RESET_URL, locale: "en" }).text.startsWith("Hi,\n")).toBe(true);
    expect(verificationEmail({ name: null, url: VERIFY_URL, locale: "en" }).text.startsWith("Hi,\n")).toBe(true);
  });

  test("each saved language writes the whole email in that language", () => {
    const fr = passwordResetEmail({ name: "Léa", url: RESET_URL, locale: "fr" });
    expect(fr.subject).toBe("Réinitialisez votre mot de passe Budget");
    expect(fr.text.startsWith("Bonjour Léa,")).toBe(true);
    expect(fr.html).toContain('lang="fr" dir="ltr"');

    const ar = verificationEmail({ name: "سارة", url: VERIFY_URL, locale: "ar" });
    expect(ar.subject).toBe("أكّد بريدك الإلكتروني في Budget");
    expect(ar.text.startsWith("مرحبًا سارة،")).toBe(true);
    // Right to left, on the document and on the card.
    expect(ar.html).toContain('lang="ar" dir="rtl"');
    expect(ar.html).toContain('<div dir="rtl"');

    const zh = passwordResetEmail({ name: "小明", url: RESET_URL, locale: "zh" });
    expect(zh.subject).toBe("重置你的 Budget 密码");
    expect(zh.text.startsWith("小明，你好：")).toBe(true);
    expect(zh.html).toContain('lang="zh" dir="ltr"');

    // The link is the same in every language.
    for (const mail of [fr, zh]) expect(lines(mail.text)).toContain(RESET_URL);
    expect(lines(ar.text)).toContain(VERIFY_URL);
  });

  test("the language is the saved one, else the app's, else English", () => {
    expect(authEmailLocale("fr", "zh-CN")).toBe("fr");
    expect(authEmailLocale("ar")).toBe("ar");
    expect(authEmailLocale("zh")).toBe("zh");
    expect(authEmailLocale("en", "fr")).toBe("en");
    // A saved language we do not write is English, not a guess from the header.
    expect(authEmailLocale("de", "fr")).toBe("en");
    // No settings yet (sign-up): the app's language, as Accept-Language.
    expect(authEmailLocale(null, "fr-CA,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(authEmailLocale(undefined, "de-DE, ar-MA;q=0.7")).toBe("ar");
    expect(authEmailLocale(null, "zh_Hans")).toBe("zh");
    expect(authEmailLocale(null, "de, es")).toBe("en");
    expect(authEmailLocale(null, null)).toBe("en");
    expect(authEmailLocale(null)).toBe("en");
  });

  test("a link with no app callback is pointed at the app; one the client named is kept", () => {
    // Sign-up without a callbackURL: Better Auth writes "/".
    const fromSignUp = withAppCallback("https://api.example.com/api/auth/verify-email?token=a.b.c&callbackURL=%2F", APP_VERIFY_EMAIL_URL);
    const v = new URL(fromSignUp);
    expect(v.searchParams.get("callbackURL")).toBe("realbudget://verify-email");
    expect(v.searchParams.get("token")).toBe("a.b.c");

    // A reset request without redirectTo: an empty callbackURL.
    const fromReset = withAppCallback("https://api.example.com/api/auth/reset-password/TOK?callbackURL=", APP_RESET_PASSWORD_URL);
    expect(new URL(fromReset).pathname).toBe("/api/auth/reset-password/TOK");
    expect(new URL(fromReset).searchParams.get("callbackURL")).toBe("realbudget://reset-password");

    // A verification callback the client named is kept.
    const named = "https://api.example.com/api/auth/verify-email?token=t&callbackURL=exp%3A%2F%2F192.168.1.5%3A8081%2F--%2Fverify-email";
    expect(withAppCallback(named, APP_VERIFY_EMAIL_URL)).toBe(named);
    expect(withAppCallback("not a url", APP_RESET_PASSWORD_URL)).toBe("not a url");
  });

  test("the reset link's token-bearing redirect always goes to the app, whatever the requester named", () => {
    // Anyone can ask for a reset of someone else's account and name a
    // trusted-but-foreign redirect; the owner's email must not honour it.
    const hostile = "https://api.example.com/api/auth/reset-password/TOK?callbackURL=exp%3A%2F%2Fattacker.example%3A8081%2F--%2Fsteal";
    const pinned = new URL(pinAppCallback(hostile, APP_RESET_PASSWORD_URL));
    expect(pinned.searchParams.get("callbackURL")).toBe("realbudget://reset-password");
    expect(pinned.pathname).toBe("/api/auth/reset-password/TOK");
    expect(pinAppCallback("not a url", APP_RESET_PASSWORD_URL)).toBe("not a url");
  });
});
