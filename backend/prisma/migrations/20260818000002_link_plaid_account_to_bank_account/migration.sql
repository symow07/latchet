-- Give each PlaidAccount a local BankAccount to mirror into, so bank-synced
-- transactions carry an accountId and move a balance.
ALTER TABLE "PlaidAccount" ADD COLUMN "bankAccountId" TEXT;
