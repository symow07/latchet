/**
 * Verbose diagnostic logging (request tracing, auth instrumentation). No-ops in
 * production — these logs include user emails and per-request timing that we
 * don't want in long-term log storage. Set DEBUG_LOGS=true to re-enable when
 * chasing a production incident. console.warn / console.error are unaffected.
 */
const enabled = process.env.NODE_ENV !== "production" || process.env.DEBUG_LOGS === "true";

export const debugLog: typeof console.log = enabled ? console.log.bind(console) : () => {};
