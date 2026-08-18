/**
 * Test preload. Runs before any test module is evaluated.
 *
 * env.ts parses process.env once at import time and exports a frozen result,
 * so anything a test needs configured must be set before the first file that
 * imports it — otherwise behaviour depends on test file ordering.
 */
process.env.PLAID_CLIENT_ID ??= "test_client_id";
process.env.PLAID_SECRET ??= "test_secret";
process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-32-chars-long!!";
