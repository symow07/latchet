import { afterAll, beforeAll, expect, test } from "bun:test";
import { prisma } from "../prisma";
import { userIsPro } from "./user-entitlement";

const FREE_ID = `entitle_free_${crypto.randomUUID().slice(0, 8)}`;
const PRO_ID = `entitle_pro_${crypto.randomUUID().slice(0, 8)}`;

beforeAll(async () => {
  const now = new Date();
  await prisma.user.create({ data: { id: FREE_ID, name: "free", email: `${FREE_ID}@x.test`, createdAt: now, updatedAt: now } });
  await prisma.user.create({
    data: {
      id: PRO_ID, name: "pro", email: `${PRO_ID}@x.test`, createdAt: now, updatedAt: now,
      entitlement: "pro", entitlementExpiresAt: new Date(Date.now() + 86_400_000),
    },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [FREE_ID, PRO_ID] } } });
});

test("dev pro override: a free user counts as Pro in development", async () => {
  expect(await userIsPro(FREE_ID, { env: { NODE_ENV: "development", DEV_PRO_OVERRIDE: "true" } })).toBe(true);
  expect(await userIsPro(FREE_ID, { env: { DEV_PRO_OVERRIDE: "true" } })).toBe(true);
});

test("dev pro override: ignored in production, where only a purchase counts", async () => {
  expect(await userIsPro(FREE_ID, { env: { NODE_ENV: "production", DEV_PRO_OVERRIDE: "true" } })).toBe(false);
  expect(await userIsPro(PRO_ID, { env: { NODE_ENV: "production", DEV_PRO_OVERRIDE: "true" } })).toBe(true);
});

test("without the override the tier is the row's, and an expired one is free", async () => {
  expect(await userIsPro(FREE_ID, { env: {} })).toBe(false);
  expect(await userIsPro(PRO_ID, { env: {} })).toBe(true);
  expect(await userIsPro(PRO_ID, { env: {}, now: new Date(Date.now() + 2 * 86_400_000) })).toBe(false);
});
