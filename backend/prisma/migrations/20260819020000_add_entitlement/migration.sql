-- Subscription entitlement, decided server-side.
-- Existing users default to "free"; nothing is granted retroactively.
ALTER TABLE "User" ADD COLUMN "entitlement" TEXT NOT NULL DEFAULT 'free';
ALTER TABLE "User" ADD COLUMN "entitlementExpiresAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "revenueCatUserId" TEXT;
