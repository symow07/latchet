import { test, expect, afterAll } from "bun:test";
import { prisma } from "../prisma";
import {
  FAILED_SIGN_IN_MAX,
  clearFailedSignIns,
  recordFailedSignIn,
  signInPaused,
  signUpAllowed,
} from "./account-limits";

// Rows outlive the run; every address carries this run's tag and is removed after.
const RUN = `acct-${process.pid}-${Date.now().toString(36)}`;
const email = (name: string) => `${name}-${RUN}@example.test`;
afterAll(async () => {
  await prisma.rateLimitBucket.deleteMany({ where: { key: { contains: RUN } } });
});

test("the tenth wrong password pauses sign-in, the ninth does not", async () => {
  const who = email("ten");
  for (let i = 0; i < FAILED_SIGN_IN_MAX - 1; i++) await recordFailedSignIn(who);
  expect(await signInPaused(who)).toBe(false);
  await recordFailedSignIn(who);
  expect(await signInPaused(who)).toBe(true);
});

test("the pause lasts fifteen minutes, by the database's clock", async () => {
  const who = email("fifteen");
  for (let i = 0; i < FAILED_SIGN_IN_MAX; i++) await recordFailedSignIn(who);
  const lock = await prisma.rateLimitBucket.findUnique({ where: { key: `lockout:sign-in-failed:${who}` } });
  expect((lock!.expiresAt.getTime() - lock!.windowStart.getTime()) / 60_000).toBe(15);
});

test("an address is one account however it is typed", async () => {
  const who = email("typed");
  for (let i = 0; i < FAILED_SIGN_IN_MAX; i++) {
    await recordFailedSignIn(i % 2 ? who.toUpperCase() : `  ${who} `);
  }
  expect(await signInPaused(who)).toBe(true);
});

test("clearing starts the count again and lifts the pause", async () => {
  const who = email("clear");
  for (let i = 0; i < FAILED_SIGN_IN_MAX; i++) await recordFailedSignIn(who);
  await clearFailedSignIns(who);
  expect(await signInPaused(who)).toBe(false);
  // A full fresh budget, not one more try.
  for (let i = 0; i < FAILED_SIGN_IN_MAX - 1; i++) await recordFailedSignIn(who);
  expect(await signInPaused(who)).toBe(false);
});

test("one account's wrong passwords do not pause another", async () => {
  for (let i = 0; i < FAILED_SIGN_IN_MAX; i++) await recordFailedSignIn(email("guessed"));
  expect(await signInPaused(email("neighbour"))).toBe(false);
});

test("an address gets three sign-up attempts an hour", async () => {
  const who = email("signup");
  const allowed = [];
  for (let i = 0; i < 4; i++) allowed.push(await signUpAllowed(i % 2 ? who.toUpperCase() : who));
  expect(allowed).toEqual([true, true, true, false]);
  expect(await signUpAllowed(email("signup-other"))).toBe(true);
});

test("an address gets ten sign-up attempts a day, even with the hour's window reset", async () => {
  const who = email("daily");
  const allowed = [];
  for (let i = 0; i < 11; i++) {
    // Empty the hour's window each time, as if the attempts were hours apart.
    await prisma.rateLimitBucket.deleteMany({ where: { key: `signup-burst:email:${who}` } });
    allowed.push(await signUpAllowed(who));
  }
  expect(allowed.slice(0, 10).every(Boolean)).toBe(true);
  expect(allowed[10]).toBe(false);
});
