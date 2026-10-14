import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildSite, GENERATED_PATH, renderLegal } from "../../scripts/build-site";
import { createSiteRouter, isPublicSitePath } from "../routes/site";
import { renderSite, SECURITY_HEADERS, siteVerificationToken } from "./pages";
import { PALETTE } from "./generated";

const pages = renderSite();
const PATHS = ["/", "/privacy", "/terms"] as const;

/** Google's Limited Use disclosure, exactly as the User Data Policy asks for it. */
const LIMITED_USE =
  "Latchet's use and transfer to any other app of information received from Google APIs will adhere to the";

const text = (html: string) =>
  html.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("generated.ts", () => {
  // The privacy policy Google and App Review read must be PRIVACY.md word for
  // word. Editing PRIVACY.md or TERMS.md (or the app's palette) without running
  // `bun scripts/build-site.ts` fails here, before it can deploy.
  test("matches PRIVACY.md, TERMS.md and the app's identity", async () => {
    expect(await buildSite()).toBe(readFileSync(GENERATED_PATH, "utf8"));
  });

  test("a policy's TODO comments never reach the page", () => {
    const doc = renderLegal("# Latchet — Policy\n\n_Last updated: today_\n\nHello.\n\n<!-- TODO(domain): internal -->\n");
    expect(doc).toEqual({ title: "Policy", updated: "today", html: "<p>Hello.</p>" });
  });

  test("a policy without its title or date is refused", () => {
    expect(() => renderLegal("Just text.")).toThrow();
  });
});

describe("the pages", () => {
  test("the privacy policy carries Google's Limited Use disclosure, with both links", () => {
    const html = pages["/privacy"];
    expect(text(html)).toContain(LIMITED_USE);
    expect(html).toContain('href="https://developers.google.com/terms/api-services-user-data-policy"');
    expect(html).toContain(
      'href="https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes"',
    );
    expect(text(html)).toContain("gmail.readonly");
  });

  test("the home page says what the app does and links to the privacy policy and terms", () => {
    const html = pages["/"];
    expect(text(html)).toContain("Every subscription and free trial, caught before it charges you.");
    expect(text(html)).toContain(LIMITED_USE);
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
    // TODO(domain): the support address is a placeholder until latchet.app is bought.
    expect(html).toContain('href="mailto:support@latchet.app"');
  });

  test("the terms cover the beta, ownership, warranties and account deletion", () => {
    const t = text(pages["/terms"]);
    for (const phrase of ["free beta", "You own everything you put into Latchet", '"as is"', "Settings → Delete Account"]) {
      expect(t).toContain(phrase);
    }
  });

  test("every page links to every other", () => {
    for (const path of PATHS) {
      for (const other of PATHS) expect(pages[path]).toContain(`href="${other}"`);
    }
  });

  test("every in-page link lands on a heading that exists", () => {
    const ids = (html: string) => new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    for (const path of PATHS) {
      const own = ids(pages[path]);
      for (const [, target] of pages[path].matchAll(/href="#([^"]+)"/g)) expect(own).toContain(target);
    }
    expect(pages["/terms"]).toContain('href="/privacy#your-controls"');
    expect(ids(pages["/privacy"])).toContain("your-controls");
  });

  // PRIVACY.md promises this ("This website"), and the CSP below depends on it.
  test("no script, no cookie, nothing loaded from another site", () => {
    for (const path of PATHS) {
      const html = pages[path];
      expect(html).not.toMatch(/<script|<iframe|<img|<form|\son[a-z]+=/i);
      // The only resource a page loads is its favicon, inline.
      const resources = [...html.matchAll(/<(?:link|source|video|audio|embed|object)\b[^>]*>/g)].map((m) => m[0]);
      expect(resources).toHaveLength(1);
      expect(resources[0]).toContain('href="data:image/svg+xml,');
      expect(html).not.toMatch(/url\(\s*['"]?(?:https?:)?\/\//i);
      expect(html).not.toContain("<!--");
    }
  });

  test("the stylesheet is the one the CSP allows", () => {
    for (const path of PATHS) {
      const css = pages[path].match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
      const hash = createHash("sha256").update(css).digest("base64");
      expect(SECURITY_HEADERS["Content-Security-Policy"]).toContain(`style-src 'sha256-${hash}'`);
    }
    expect(SECURITY_HEADERS["Content-Security-Policy"]).toContain("default-src 'none'");
  });

  test("the identity: the off-white page, never pure white, and one espresso anchor", () => {
    for (const path of PATHS) {
      const html = pages[path];
      expect(html).toContain(`--ground:${PALETTE.light.ground}`);
      expect(html).toContain(`--ground:${PALETTE.dark.ground}`);
      expect(html).not.toMatch(/#fff(?:fff)?\b/i);
      expect(html.match(/class="anchor[ "]/g)).toHaveLength(1);
    }
  });
});

describe("Search Console verification", () => {
  test("takes the bare token or the whole pasted tag, and ignores anything else", () => {
    expect(siteVerificationToken(undefined)).toBeNull();
    expect(siteVerificationToken("  ")).toBeNull();
    expect(siteVerificationToken("abcDEF123_-xyz789")).toBe("abcDEF123_-xyz789");
    expect(siteVerificationToken('<meta name="google-site-verification" content="abcDEF123_-xyz789" />')).toBe(
      "abcDEF123_-xyz789",
    );
    expect(siteVerificationToken('"><script>alert(1)</script>')).toBeNull();
  });

  test("puts the tag on the home page only, and only when set", () => {
    const tag = '<meta name="google-site-verification" content="abcDEF123_-xyz789">';
    const verified = renderSite({ siteVerification: "abcDEF123_-xyz789" });
    expect(verified["/"]).toContain(tag);
    expect(verified["/privacy"]).not.toContain("google-site-verification");
    expect(pages["/"]).not.toContain("google-site-verification");
  });
});

describe("routes", () => {
  const router = createSiteRouter();

  test("serve each page as HTML with the security headers, with or without a trailing slash", async () => {
    for (const path of ["/", "/privacy", "/privacy/", "/terms", "/terms/"]) {
      const res = await router.request(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(res.headers.get("content-security-policy")).toBe(SECURITY_HEADERS["Content-Security-Policy"]!);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await res.text()).toStartWith("<!doctype html>");
    }
  });

  test("answer HEAD, which link checkers and Google's crawler send", async () => {
    const res = await router.request("/privacy", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  test("are public: the session middleware skips exactly these paths", () => {
    for (const path of ["/", "/privacy", "/privacy/", "/terms", "/terms/"]) expect(isPublicSitePath(path)).toBe(true);
    for (const path of ["/health", "/api/v1/me", "/privacy/x", "/privacyx", "//", "/terms.html"]) {
      expect(isPublicSitePath(path)).toBe(false);
    }
  });

  test("are mounted on the served app, ahead of the JSON 404", async () => {
    const { app } = await import("../index");
    const page = await app.request("/terms");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await page.text()).toContain("Terms of Service");
    const missing = await app.request("/privacy/elsewhere");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain("application/json");
  });
});
