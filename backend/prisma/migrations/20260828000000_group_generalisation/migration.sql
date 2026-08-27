-- Business becomes Group: a household is the same shape with different labels.
--
-- Hand-written, because `prisma migrate dev` renders a model rename as
-- DROP TABLE + CREATE TABLE. That is correct for an empty database and
-- catastrophic for the 52 MB already on the production volume. SQLite's
-- ALTER TABLE ... RENAME (3.25+) rewrites the foreign keys in dependent
-- tables for us, so the data is carried across rather than recreated.
--
-- The pragma below is load-bearing. SQLite rewrites a REFERENCES clause that
-- points at a renamed table ONLY while foreign key enforcement is on. Prisma
-- enables it, so `migrate deploy` is fine either way -- but the sqlite3 CLI
-- defaults to OFF, and applying this file by hand without it leaves every
-- child table referencing a "Business" that no longer exists. Silently: the
-- rows all survive and `foreign_key_check` is where it surfaces. Inside
-- Prisma's transaction the statement is an inert no-op.

PRAGMA foreign_keys=ON;

-- ── Tables ───────────────────────────────────────────────────────────────────
ALTER TABLE "Business" RENAME TO "Group";
ALTER TABLE "TeamMember" RENAME TO "GroupMember";
ALTER TABLE "BusinessBudget" RENAME TO "GroupBudget";

-- ── Columns ──────────────────────────────────────────────────────────────────
ALTER TABLE "GroupMember" RENAME COLUMN "businessId" TO "groupId";
ALTER TABLE "GroupBudget" RENAME COLUMN "businessId" TO "groupId";
ALTER TABLE "Expense"     RENAME COLUMN "businessId" TO "groupId";
ALTER TABLE "Salary"      RENAME COLUMN "businessId" TO "groupId";
ALTER TABLE "UserSettings" RENAME COLUMN "activeBusinessId" TO "activeGroupId";

-- ── New columns ──────────────────────────────────────────────────────────────
-- Every row that exists today is a business; the default is the truth, not a guess.
ALTER TABLE "Group" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'business';

-- 'summary' is the least revealing value. A member who has not chosen cannot
-- be over-shared by the absence of a choice.
ALTER TABLE "GroupMember" ADD COLUMN "shareLevel" TEXT NOT NULL DEFAULT 'summary';

-- Opt-in per account. NULL default is required by SQLite for an added column
-- carrying a REFERENCES clause.
ALTER TABLE "BankAccount" ADD COLUMN "sharedWithGroupId" TEXT
  REFERENCES "Group"("id") ON DELETE SET NULL;

-- ── Indexes ──────────────────────────────────────────────────────────────────
-- SQLite carries indexes across a table rename but keeps their old names.
DROP INDEX IF EXISTS "Business_ownerId_key";
DROP INDEX IF EXISTS "Business_inviteCode_key";
DROP INDEX IF EXISTS "TeamMember_businessId_userId_key";
DROP INDEX IF EXISTS "BusinessBudget_businessId_key";
DROP INDEX IF EXISTS "Expense_businessId_status_idx";
DROP INDEX IF EXISTS "Expense_businessId_submittedAt_idx";
DROP INDEX IF EXISTS "Salary_businessId_idx";
DROP INDEX IF EXISTS "Salary_businessId_userId_key";

-- ownerId was UNIQUE on its own, which predates households and would force a
-- small-business owner to choose between owning a company and sharing a
-- household. Scoped to (ownerId, type): one business AND one household each.
CREATE UNIQUE INDEX "Group_ownerId_type_key"        ON "Group"("ownerId", "type");
CREATE UNIQUE INDEX "Group_inviteCode_key"          ON "Group"("inviteCode");
CREATE UNIQUE INDEX "GroupMember_groupId_userId_key" ON "GroupMember"("groupId", "userId");
CREATE UNIQUE INDEX "GroupBudget_groupId_key"       ON "GroupBudget"("groupId");
CREATE INDEX        "Expense_groupId_status_idx"    ON "Expense"("groupId", "status");
CREATE INDEX        "Expense_groupId_submittedAt_idx" ON "Expense"("groupId", "submittedAt");
CREATE INDEX        "Salary_groupId_idx"            ON "Salary"("groupId");
CREATE UNIQUE INDEX "Salary_groupId_userId_key"     ON "Salary"("groupId", "userId");
CREATE INDEX        "BankAccount_sharedWithGroupId_idx" ON "BankAccount"("sharedWithGroupId");
