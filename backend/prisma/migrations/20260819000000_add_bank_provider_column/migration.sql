-- Attribute each bank connection to the provider that owns it, so a second
-- provider (Salt Edge, TrueLayer) can coexist with Plaid.
ALTER TABLE "PlaidItem" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'plaid';
