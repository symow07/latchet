-- Company profile and tax identity for a business.
--
-- All nullable and with no default: a business that existed before this
-- migration simply has none of them set, and the app treats absent and empty
-- the same way. Nothing here is required to use the product.
ALTER TABLE "Business" ADD COLUMN "address" TEXT;
ALTER TABLE "Business" ADD COLUMN "vatNumber" TEXT;
ALTER TABLE "Business" ADD COLUMN "taxId" TEXT;

-- Month the fiscal year starts, 1-12. Only the month is meaningful, so this is
-- not a date: a date would carry a day and a timezone that mean nothing here.
ALTER TABLE "Business" ADD COLUMN "fiscalYearStartMonth" INTEGER;
