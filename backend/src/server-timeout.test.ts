import { expect, test } from "bun:test";
import server, { SERVER_IDLE_TIMEOUT_SECONDS } from "./index";
import { DEFAULT_TIMEOUT_MS } from "./lib/fetch-timeout";
import { REMOVE_CONNECTION_TIMEOUT_MS } from "./lib/bank-sync";

// Bun closes a request that sends nothing for `idleTimeout` seconds (10 by
// default). Shorter than a handler's own waits, the app sees a dropped
// connection for work the server then completes: a bank disconnect that did
// happen was reported as "Couldn't disconnect".
test("the server waits longer than any handler's own upstream or database wait", () => {
  expect(server.idleTimeout).toBe(SERVER_IDLE_TIMEOUT_SECONDS);
  expect(SERVER_IDLE_TIMEOUT_SECONDS * 1000).toBeGreaterThan(DEFAULT_TIMEOUT_MS);
  // Revoking at the bank (one upstream call), then the deletion transaction.
  expect(SERVER_IDLE_TIMEOUT_SECONDS * 1000).toBeGreaterThan(DEFAULT_TIMEOUT_MS + REMOVE_CONNECTION_TIMEOUT_MS);
  // Bun refuses anything above 255.
  expect(SERVER_IDLE_TIMEOUT_SECONDS).toBeLessThanOrEqual(255);
});
