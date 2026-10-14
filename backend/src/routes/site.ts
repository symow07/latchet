/**
 * The public website: GET /, /privacy and /terms (site/pages.ts).
 *
 * Public by design: these are the URLs on Google's OAuth Branding page and in
 * the store listings, so they answer without a session, and the session
 * middleware skips them (isPublicSitePath) rather than spending a database
 * round-trip on a visitor who has no account.
 *
 * The pages are rendered once, at startup: they are static apart from the
 * optional Search Console tag, which comes from the environment.
 */
import { Hono } from "hono";
import { renderSite, SECURITY_HEADERS, siteVerificationToken, type SitePages } from "../site/pages";

const PATHS = ["/", "/privacy", "/terms"] as const satisfies ReadonlyArray<keyof SitePages>;

export function isPublicSitePath(path: string): boolean {
  return /^\/(?:privacy\/?|terms\/?)?$/.test(path);
}

export function createSiteRouter(options: { siteVerification?: string } = {}) {
  const pages = renderSite({ siteVerification: siteVerificationToken(options.siteVerification) });
  const router = new Hono();
  for (const path of PATHS) {
    const html = pages[path];
    const respond = () =>
      new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8", ...SECURITY_HEADERS },
      });
    router.get(path, respond);
    if (path !== "/") router.get(`${path}/`, respond);
  }
  return router;
}
