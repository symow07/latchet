/**
 * The server's bounds on what the four Phase 4 screens save. Checked on the
 * phone because a row saved here goes to the server later, at the next sync,
 * where a refusal has no one to show it to.
 */

/** The most one amount may be: the server's MAX_MONEY (backend/src/lib/schemas.ts). */
export const MAX_AMOUNT = 10_000_000;
