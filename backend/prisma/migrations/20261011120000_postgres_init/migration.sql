-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "entitlement" TEXT NOT NULL DEFAULT 'free',
    "entitlementExpiresAt" TIMESTAMP(3),
    "revenueCatUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthAccount" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "openingBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "color" TEXT NOT NULL DEFAULT '#a855f7',
    "icon" TEXT NOT NULL DEFAULT 'wallet',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sharedWithGroupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "clientUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "serverUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "category" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isImpulse" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "dateISO" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "clientUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "serverUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "monthlyBudget" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startingBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hourlyValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "showTimeCost" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "currencySymbol" TEXT NOT NULL DEFAULT '$',
    "monthlyIncome" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "savingsGoal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "spendingStyle" TEXT NOT NULL DEFAULT 'moderate',
    "primaryGoal" TEXT NOT NULL DEFAULT 'track',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "activeGroupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "clientUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "serverUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillReminder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "dueDay" INTEGER NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Other',
    "isRecurring" BOOLEAN NOT NULL DEFAULT true,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "nextDueDate" TEXT NOT NULL,
    "lastNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT,
    "name" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "category" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isImpulse" BOOLEAN NOT NULL DEFAULT false,
    "frequency" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "nextDate" TEXT NOT NULL,
    "lastCreated" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetWorthEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "assets" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "liabilities" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netWorth" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "breakdown" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NetWorthEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryBudget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'monthly',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Achievement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "badge" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bestStreak" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaidItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'plaid',
    "itemId" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "institutionId" TEXT,
    "institutionName" TEXT,
    "cursor" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaidItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaidAccount" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "plaidAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "mask" TEXT,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "bankAccountId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaidAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'forwarding',
    "email" TEXT NOT NULL,
    "inboundToken" TEXT,
    "forwardingVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxEmail" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "senderDomain" TEXT,
    "label" TEXT NOT NULL DEFAULT '',
    "merchant" TEXT,
    "amount" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "cadence" TEXT NOT NULL DEFAULT 'unknown',
    "chargedISO" TEXT,
    "isSubscription" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'parsed',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'business',
    "logoUrl" TEXT,
    "address" TEXT,
    "vatNumber" TEXT,
    "taxId" TEXT,
    "fiscalYearStartMonth" INTEGER,
    "inviteCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "shareLevel" TEXT NOT NULL DEFAULT 'summary',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "submitterId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "imageUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupBudget" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "totalMonthly" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "categories" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Salary" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Salary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryPayment" (
    "id" TEXT NOT NULL,
    "salaryId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unpaid',
    "paidAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomCategory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT '#94a3b8',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "serverUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "syncId" TEXT NOT NULL,
    "merchantDisplay" TEXT NOT NULL,
    "merchantNormalized" TEXT NOT NULL,
    "cadence" TEXT NOT NULL DEFAULT 'monthly',
    "typicalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastChargedAt" TEXT,
    "nextExpectedAt" TEXT,
    "status" TEXT NOT NULL DEFAULT 'possible',
    "cancelUrl" TEXT,
    "cancelNotes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'transaction',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "serverUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncTombstone" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "syncId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncTombstone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "CacheEntry" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CacheEntry_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ownerId" TEXT,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobLease" (
    "name" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "leaseUntil" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobLease_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "BankAccount_sharedWithGroupId_idx" ON "BankAccount"("sharedWithGroupId");

-- CreateIndex
CREATE INDEX "BankAccount_userId_serverUpdatedAt_idx" ON "BankAccount"("userId", "serverUpdatedAt");

-- CreateIndex
CREATE INDEX "Transaction_userId_dateISO_idx" ON "Transaction"("userId", "dateISO");

-- CreateIndex
CREATE INDEX "Transaction_userId_serverUpdatedAt_idx" ON "Transaction"("userId", "serverUpdatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- CreateIndex
CREATE INDEX "BillReminder_userId_nextDueDate_idx" ON "BillReminder"("userId", "nextDueDate");

-- CreateIndex
CREATE INDEX "RecurringTransaction_userId_idx" ON "RecurringTransaction"("userId");

-- CreateIndex
CREATE INDEX "RecurringTransaction_isActive_nextDate_idx" ON "RecurringTransaction"("isActive", "nextDate");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryBudget_userId_category_key" ON "CategoryBudget"("userId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_userId_badge_key" ON "Achievement"("userId", "badge");

-- CreateIndex
CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "PlaidItem_itemId_key" ON "PlaidItem"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaidAccount_plaidAccountId_key" ON "PlaidAccount"("plaidAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailConnection_inboundToken_key" ON "EmailConnection"("inboundToken");

-- CreateIndex
CREATE UNIQUE INDEX "EmailConnection_userId_email_key" ON "EmailConnection"("userId", "email");

-- CreateIndex
CREATE INDEX "InboxEmail_userId_receivedAt_idx" ON "InboxEmail"("userId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Group_inviteCode_key" ON "Group"("inviteCode");

-- CreateIndex
CREATE UNIQUE INDEX "Group_ownerId_type_key" ON "Group"("ownerId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_groupId_userId_key" ON "GroupMember"("groupId", "userId");

-- CreateIndex
CREATE INDEX "Expense_groupId_status_idx" ON "Expense"("groupId", "status");

-- CreateIndex
CREATE INDEX "Expense_groupId_submittedAt_idx" ON "Expense"("groupId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GroupBudget_groupId_key" ON "GroupBudget"("groupId");

-- CreateIndex
CREATE INDEX "Salary_groupId_idx" ON "Salary"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "Salary_groupId_userId_key" ON "Salary"("groupId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryPayment_salaryId_month_year_key" ON "SalaryPayment"("salaryId", "month", "year");

-- CreateIndex
CREATE INDEX "CustomCategory_userId_serverUpdatedAt_idx" ON "CustomCategory"("userId", "serverUpdatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomCategory_userId_name_key" ON "CustomCategory"("userId", "name");

-- CreateIndex
CREATE INDEX "Subscription_userId_serverUpdatedAt_idx" ON "Subscription"("userId", "serverUpdatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_syncId_key" ON "Subscription"("userId", "syncId");

-- CreateIndex
CREATE INDEX "SyncTombstone_userId_deletedAt_idx" ON "SyncTombstone"("userId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SyncTombstone_userId_entity_syncId_key" ON "SyncTombstone"("userId", "entity", "syncId");

-- CreateIndex
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");

-- CreateIndex
CREATE INDEX "CacheEntry_expiresAt_idx" ON "CacheEntry"("expiresAt");

-- CreateIndex
CREATE INDEX "StoredFile_kind_ownerId_idx" ON "StoredFile"("kind", "ownerId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthAccount" ADD CONSTRAINT "AuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_sharedWithGroupId_fkey" FOREIGN KEY ("sharedWithGroupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillReminder" ADD CONSTRAINT "BillReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringTransaction" ADD CONSTRAINT "RecurringTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetWorthEntry" ADD CONSTRAINT "NetWorthEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryBudget" ADD CONSTRAINT "CategoryBudget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaidItem" ADD CONSTRAINT "PlaidItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaidAccount" ADD CONSTRAINT "PlaidAccount_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PlaidItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailConnection" ADD CONSTRAINT "EmailConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxEmail" ADD CONSTRAINT "InboxEmail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_submitterId_fkey" FOREIGN KEY ("submitterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupBudget" ADD CONSTRAINT "GroupBudget_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Salary" ADD CONSTRAINT "Salary_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Salary" ADD CONSTRAINT "Salary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryPayment" ADD CONSTRAINT "SalaryPayment_salaryId_fkey" FOREIGN KEY ("salaryId") REFERENCES "Salary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomCategory" ADD CONSTRAINT "CustomCategory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ═════════════════════════════════════════════════════════════════════════════
-- Triggers (hand-written; everything above is generated by Prisma from
-- schema.prisma). Prisma's drift check does not look at functions or triggers,
-- so `prisma migrate diff` against a database built from this file stays empty.
--
-- Timestamps: Prisma stores DateTime as UTC in `timestamp(3)` columns, which
-- carry no zone. clock_timestamp() is a timestamptz, and assigning one to such a
-- column converts it with the SESSION'S TimeZone, which is not necessarily UTC
-- (a developer machine is usually local time). Every stamp below therefore
-- converts explicitly with AT TIME ZONE 'UTC' and is truncated to the column's
-- millisecond precision, so it is never later than the clock reading.
--
-- Every function keeps the search_path it was created with, the one Prisma
-- created the tables under, so a trigger fired from a session with a different
-- search_path (a psql session, a ?schema= URL) still resolves the same tables.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── serverUpdatedAt ─────────────────────────────────────────────────────────
-- The sync cursor. The database's clock, not any app instance's, and
-- clock_timestamp() rather than now(): now() is frozen at transaction start, so
-- every row a long transaction writes would carry that start time however long
-- it ran before committing. A stamp is still taken before its commit; the pull
-- holds its cursor PULL_SAFETY_LAG_MS behind the clock to cover that gap.

CREATE FUNCTION "sync_stamp_server_updated_at"() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  NEW."serverUpdatedAt" := date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC');
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Transaction_stamp_serverUpdatedAt"
  BEFORE INSERT OR UPDATE ON "Transaction"
  FOR EACH ROW EXECUTE FUNCTION "sync_stamp_server_updated_at"();

CREATE TRIGGER "BankAccount_stamp_serverUpdatedAt"
  BEFORE INSERT OR UPDATE ON "BankAccount"
  FOR EACH ROW EXECUTE FUNCTION "sync_stamp_server_updated_at"();

CREATE TRIGGER "UserSettings_stamp_serverUpdatedAt"
  BEFORE INSERT OR UPDATE ON "UserSettings"
  FOR EACH ROW EXECUTE FUNCTION "sync_stamp_server_updated_at"();

CREATE TRIGGER "CustomCategory_stamp_serverUpdatedAt"
  BEFORE INSERT OR UPDATE ON "CustomCategory"
  FOR EACH ROW EXECUTE FUNCTION "sync_stamp_server_updated_at"();

CREATE TRIGGER "Subscription_stamp_serverUpdatedAt"
  BEFORE INSERT OR UPDATE ON "Subscription"
  FOR EACH ROW EXECUTE FUNCTION "sync_stamp_server_updated_at"();

-- ─── Tombstones ──────────────────────────────────────────────────────────────
-- One SyncTombstone per deleted synced row, whatever deleted it: a route, a
-- sync push, a cascade from a deleted account or user, a bank unlink. Keyed by
-- (userId, entity, syncId), so deleting, re-creating and deleting the same row
-- again leaves one tombstone whose deletedAt moved forward; its clientUpdatedAt
-- never moves backward. Removing a tombstone when a row is resurrected is the
-- sync push's decision, not a trigger's.
--
-- SyncTombstone has no foreign key to User on purpose: deleting a user cascades
-- into these tables, and a key back to that user would fail inside its own
-- cascade. Retention purges the orphans.

CREATE FUNCTION "sync_record_tombstone"() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  sync_entity text;
  sync_id text;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'Transaction' THEN
      sync_entity := 'transactions';
      sync_id := OLD."id";
    WHEN 'BankAccount' THEN
      sync_entity := 'accounts';
      sync_id := OLD."id";
    WHEN 'UserSettings' THEN
      sync_entity := 'settings';
      sync_id := 'settings';
    WHEN 'CustomCategory' THEN
      sync_entity := 'categories';
      sync_id := OLD."name";
    WHEN 'Subscription' THEN
      sync_entity := 'subscriptions';
      sync_id := OLD."syncId";
  END CASE;

  INSERT INTO "SyncTombstone" ("id", "userId", "entity", "syncId", "deletedAt", "clientUpdatedAt")
  VALUES (
    gen_random_uuid()::text,
    OLD."userId",
    sync_entity,
    sync_id,
    date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC'),
    OLD."clientUpdatedAt"
  )
  ON CONFLICT ("userId", "entity", "syncId") DO UPDATE SET
    "deletedAt" = EXCLUDED."deletedAt",
    "clientUpdatedAt" = GREATEST("SyncTombstone"."clientUpdatedAt", EXCLUDED."clientUpdatedAt");

  RETURN NULL;
END;
$$;

CREATE TRIGGER "Transaction_tombstone"
  AFTER DELETE ON "Transaction"
  FOR EACH ROW EXECUTE FUNCTION "sync_record_tombstone"();

CREATE TRIGGER "BankAccount_tombstone"
  AFTER DELETE ON "BankAccount"
  FOR EACH ROW EXECUTE FUNCTION "sync_record_tombstone"();

CREATE TRIGGER "UserSettings_tombstone"
  AFTER DELETE ON "UserSettings"
  FOR EACH ROW EXECUTE FUNCTION "sync_record_tombstone"();

CREATE TRIGGER "CustomCategory_tombstone"
  AFTER DELETE ON "CustomCategory"
  FOR EACH ROW EXECUTE FUNCTION "sync_record_tombstone"();

CREATE TRIGGER "Subscription_tombstone"
  AFTER DELETE ON "Subscription"
  FOR EACH ROW EXECUTE FUNCTION "sync_record_tombstone"();

-- ─── Derived account balance ─────────────────────────────────────────────────
-- balance = openingBalance + Σ Income − Σ everything else, over the account's
-- transactions: the formula the phone uses (mobile/src/lib/db.ts,
-- recomputeAccountBalances), so both sides derive the same number. The sum is
-- restricted to the account owner's rows, which is what lets it use the
-- (userId, …) indexes instead of scanning every user's ledger; a transaction
-- belongs to the same user as its account.

-- Recomputes the given accounts from scratch. A full recompute rather than an
-- increment: it cannot drift, and running it twice changes nothing.
CREATE FUNCTION "recompute_account_balances"(account_ids text[]) RETURNS void
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  -- Lock first, in id order, so two writers touching the same accounts queue
  -- instead of deadlocking. FOR NO KEY UPDATE, not FOR UPDATE: inserting a
  -- transaction already holds FOR KEY SHARE on its account (the foreign key
  -- check), and FOR UPDATE would conflict with another writer's KEY SHARE.
  PERFORM 1 FROM "BankAccount"
   WHERE "id" = ANY (account_ids)
   ORDER BY "id"
     FOR NO KEY UPDATE;

  -- A new statement takes a new snapshot (READ COMMITTED), so this sum sees
  -- every ledger change committed by whoever held these locks before us. Had
  -- the sum run in the same statement that waited for the lock, it would read
  -- the snapshot from before the wait and lose a concurrent insert.
  UPDATE "BankAccount" AS a
     SET "balance" = s."balance"
    FROM (
      SELECT b."id",
             b."openingBalance" + COALESCE(SUM(
               CASE WHEN t."type" = 'Income' THEN t."amount" ELSE -t."amount" END
             ), 0) AS "balance"
        FROM "BankAccount" AS b
        LEFT JOIN "Transaction" AS t
          ON t."userId" = b."userId" AND t."accountId" = b."id"
       WHERE b."id" = ANY (account_ids)
       GROUP BY b."id", b."openingBalance"
    ) AS s
   WHERE a."id" = s."id"
     AND a."balance" IS DISTINCT FROM s."balance";
END;
$$;

-- Statement-level, with transition tables: a bulk write (createMany, a sync
-- batch, a cascade) recomputes each affected account once rather than once per
-- row. A transaction moved between accounts recomputes both. An update that
-- changes none of amount, type, account or owner (a note, a category)
-- recomputes nothing.

CREATE FUNCTION "transaction_balance_after_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  account_ids text[];
BEGIN
  SELECT array_agg(DISTINCT n."accountId") INTO account_ids
    FROM inserted_rows AS n
   WHERE n."accountId" IS NOT NULL;
  IF account_ids IS NOT NULL THEN
    PERFORM "recompute_account_balances"(account_ids);
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION "transaction_balance_after_update"() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  account_ids text[];
BEGIN
  SELECT array_agg(DISTINCT x."accountId") INTO account_ids
    FROM (
      SELECT o."accountId"
        FROM old_rows AS o
        LEFT JOIN new_rows AS n ON n."id" = o."id"
       WHERE n."id" IS NULL
          OR n."accountId" IS DISTINCT FROM o."accountId"
          OR n."amount" IS DISTINCT FROM o."amount"
          OR n."type" IS DISTINCT FROM o."type"
          OR n."userId" IS DISTINCT FROM o."userId"
      UNION
      SELECT n."accountId"
        FROM new_rows AS n
        LEFT JOIN old_rows AS o ON o."id" = n."id"
       WHERE o."id" IS NULL
          OR n."accountId" IS DISTINCT FROM o."accountId"
          OR n."amount" IS DISTINCT FROM o."amount"
          OR n."type" IS DISTINCT FROM o."type"
          OR n."userId" IS DISTINCT FROM o."userId"
    ) AS x
   WHERE x."accountId" IS NOT NULL;
  IF account_ids IS NOT NULL THEN
    PERFORM "recompute_account_balances"(account_ids);
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION "transaction_balance_after_delete"() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  account_ids text[];
BEGIN
  SELECT array_agg(DISTINCT o."accountId") INTO account_ids
    FROM deleted_rows AS o
   WHERE o."accountId" IS NOT NULL;
  IF account_ids IS NOT NULL THEN
    PERFORM "recompute_account_balances"(account_ids);
  END IF;
  RETURN NULL;
END;
$$;

-- TRUNCATE fires no delete trigger; with the whole ledger gone every account is
-- back at its opening balance. (Truncation is for tests and maintenance: it
-- writes no tombstones.)
CREATE FUNCTION "transaction_balance_after_truncate"() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  UPDATE "BankAccount"
     SET "balance" = "openingBalance"
   WHERE "balance" IS DISTINCT FROM "openingBalance";
  RETURN NULL;
END;
$$;

CREATE TRIGGER "Transaction_balance_insert"
  AFTER INSERT ON "Transaction"
  REFERENCING NEW TABLE AS inserted_rows
  FOR EACH STATEMENT EXECUTE FUNCTION "transaction_balance_after_insert"();

CREATE TRIGGER "Transaction_balance_update"
  AFTER UPDATE ON "Transaction"
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION "transaction_balance_after_update"();

CREATE TRIGGER "Transaction_balance_delete"
  AFTER DELETE ON "Transaction"
  REFERENCING OLD TABLE AS deleted_rows
  FOR EACH STATEMENT EXECUTE FUNCTION "transaction_balance_after_delete"();

CREATE TRIGGER "Transaction_balance_truncate"
  AFTER TRUNCATE ON "Transaction"
  FOR EACH STATEMENT EXECUTE FUNCTION "transaction_balance_after_truncate"();

-- The account's own side: a new account, or a changed opening balance (or
-- owner, since the sum is over the owner's rows), derives its balance before
-- the row is written. BEFORE UPDATE runs with the row already locked, so the
-- sum here cannot miss a ledger write that committed first, and a ledger write
-- that comes later waits for this one.
CREATE FUNCTION "bank_account_derive_balance"() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  NEW."balance" := NEW."openingBalance" + COALESCE((
    SELECT SUM(CASE WHEN t."type" = 'Income' THEN t."amount" ELSE -t."amount" END)
      FROM "Transaction" AS t
     WHERE t."userId" = NEW."userId" AND t."accountId" = NEW."id"
  ), 0);
  RETURN NEW;
END;
$$;

CREATE TRIGGER "BankAccount_derive_balance"
  BEFORE INSERT OR UPDATE OF "openingBalance", "userId" ON "BankAccount"
  FOR EACH ROW EXECUTE FUNCTION "bank_account_derive_balance"();
