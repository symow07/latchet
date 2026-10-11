-- Phase 4: recurring series, bill reminders, category budgets and net-worth
-- snapshots become synced entities (PLAN.md decision 1, I-WIRE-4), with the
-- same bookkeeping as the five Phase 3 tables: clientUpdatedAt (last writer
-- wins by it), serverUpdatedAt (stamped by trigger from the database clock;
-- the pull cursor orders by it) and a SyncTombstone for every delete.
--
-- Times follow the init migration's rule: Prisma DateTime columns are
-- timestamp(3) holding UTC, and the server's time zone need not be UTC, so
-- every stamp converts explicitly with AT TIME ZONE 'UTC'.

-- AlterTable
ALTER TABLE "BillReminder" ADD COLUMN     "clientUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "serverUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "CategoryBudget" ADD COLUMN     "clientUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "serverUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "NetWorthEntry" ADD COLUMN     "clientUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "serverUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "RecurringTransaction" ADD COLUMN     "clientUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "serverUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ─── Backfill ────────────────────────────────────────────────────────────────
-- The column default above is CURRENT_TIMESTAMP in the session's zone, which
-- is not UTC on every server. Existing rows get their real last-change time
-- (updatedAt; createdAt for net-worth snapshots, which are never edited) as
-- clientUpdatedAt, and the database's UTC clock as serverUpdatedAt. Done
-- before the triggers exist, so nothing else fires.
UPDATE "BillReminder"
   SET "clientUpdatedAt" = "updatedAt",
       "serverUpdatedAt" = date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC');

UPDATE "CategoryBudget"
   SET "clientUpdatedAt" = "updatedAt",
       "serverUpdatedAt" = date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC');

UPDATE "NetWorthEntry"
   SET "clientUpdatedAt" = "createdAt",
       "serverUpdatedAt" = date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC');

UPDATE "RecurringTransaction"
   SET "clientUpdatedAt" = "updatedAt",
       "serverUpdatedAt" = date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC');

-- A series' account was stored as sent and never checked. One that is gone
-- or belongs to someone else was never booked onto (recurring-booking.ts);
-- unlink it, so the foreign key below holds and no phone is sent an account
-- it does not have (PLAN.md decision 5).
UPDATE "RecurringTransaction" AS r
   SET "accountId" = NULL
 WHERE r."accountId" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "BankAccount" AS a WHERE a."id" = r."accountId" AND a."userId" = r."userId"
   );

-- CreateIndex
CREATE INDEX "BillReminder_userId_serverUpdatedAt_idx" ON "BillReminder"("userId", "serverUpdatedAt");

-- CreateIndex
CREATE INDEX "RecurringTransaction_userId_serverUpdatedAt_idx" ON "RecurringTransaction"("userId", "serverUpdatedAt");

-- CreateIndex
CREATE INDEX "RecurringTransaction_accountId_idx" ON "RecurringTransaction"("accountId");

-- CreateIndex
CREATE INDEX "NetWorthEntry_userId_serverUpdatedAt_idx" ON "NetWorthEntry"("userId", "serverUpdatedAt");

-- CreateIndex
CREATE INDEX "CategoryBudget_userId_serverUpdatedAt_idx" ON "CategoryBudget"("userId", "serverUpdatedAt");

-- AddForeignKey
ALTER TABLE "RecurringTransaction" ADD CONSTRAINT "RecurringTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ═════════════════════════════════════════════════════════════════════════════
-- Triggers (hand-written; Prisma never sees them). The functions are the init
-- migration's; see the notes there.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── serverUpdatedAt ─────────────────────────────────────────────────────────

CREATE TRIGGER "RecurringTransaction_stamp_serverUpdatedAt"
  BEFORE INSERT OR UPDATE ON "RecurringTransaction"
  FOR EACH ROW EXECUTE FUNCTION "sync_stamp_server_updated_at"();

CREATE TRIGGER "BillReminder_stamp_serverUpdatedAt"
  BEFORE INSERT OR UPDATE ON "BillReminder"
  FOR EACH ROW EXECUTE FUNCTION "sync_stamp_server_updated_at"();

CREATE TRIGGER "CategoryBudget_stamp_serverUpdatedAt"
  BEFORE INSERT OR UPDATE ON "CategoryBudget"
  FOR EACH ROW EXECUTE FUNCTION "sync_stamp_server_updated_at"();

CREATE TRIGGER "NetWorthEntry_stamp_serverUpdatedAt"
  BEFORE INSERT OR UPDATE ON "NetWorthEntry"
  FOR EACH ROW EXECUTE FUNCTION "sync_stamp_server_updated_at"();

-- ─── Tombstones ──────────────────────────────────────────────────────────────
-- The init migration's function with four more arms; the five Phase 3 arms are
-- unchanged. A category budget is keyed by its category, as categories are by
-- their name.
--
-- It also runs AFTER UPDATE for a table whose sync id is a column a write can
-- change (CategoryBudget.category): a budget moved to another category is, to
-- a phone, the old key deleted and a new one created, and without a tombstone
-- the phone would keep the old key forever. That tombstone carries the
-- update's clientUpdatedAt, the time the old key stopped existing.

CREATE OR REPLACE FUNCTION "sync_record_tombstone"() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  sync_entity text;
  sync_id text;
  sync_cu timestamp(3);
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
    WHEN 'RecurringTransaction' THEN
      sync_entity := 'recurring';
      sync_id := OLD."id";
    WHEN 'BillReminder' THEN
      sync_entity := 'billReminders';
      sync_id := OLD."id";
    WHEN 'CategoryBudget' THEN
      sync_entity := 'categoryBudgets';
      sync_id := OLD."category";
    WHEN 'NetWorthEntry' THEN
      sync_entity := 'netWorth';
      sync_id := OLD."id";
  END CASE;

  -- NEW is read only on UPDATE: it holds no row on DELETE.
  IF TG_OP = 'UPDATE' THEN
    sync_cu := NEW."clientUpdatedAt";
  ELSE
    sync_cu := OLD."clientUpdatedAt";
  END IF;

  INSERT INTO "SyncTombstone" ("id", "userId", "entity", "syncId", "deletedAt", "clientUpdatedAt")
  VALUES (
    gen_random_uuid()::text,
    OLD."userId",
    sync_entity,
    sync_id,
    date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC'),
    sync_cu
  )
  ON CONFLICT ("userId", "entity", "syncId") DO UPDATE SET
    "deletedAt" = EXCLUDED."deletedAt",
    "clientUpdatedAt" = GREATEST("SyncTombstone"."clientUpdatedAt", EXCLUDED."clientUpdatedAt");

  RETURN NULL;
END;
$$;

CREATE TRIGGER "RecurringTransaction_tombstone"
  AFTER DELETE ON "RecurringTransaction"
  FOR EACH ROW EXECUTE FUNCTION "sync_record_tombstone"();

CREATE TRIGGER "BillReminder_tombstone"
  AFTER DELETE ON "BillReminder"
  FOR EACH ROW EXECUTE FUNCTION "sync_record_tombstone"();

CREATE TRIGGER "CategoryBudget_tombstone"
  AFTER DELETE ON "CategoryBudget"
  FOR EACH ROW EXECUTE FUNCTION "sync_record_tombstone"();

CREATE TRIGGER "NetWorthEntry_tombstone"
  AFTER DELETE ON "NetWorthEntry"
  FOR EACH ROW EXECUTE FUNCTION "sync_record_tombstone"();

CREATE TRIGGER "CategoryBudget_tombstone_rekey"
  AFTER UPDATE OF "category", "userId" ON "CategoryBudget"
  FOR EACH ROW
  WHEN (OLD."category" IS DISTINCT FROM NEW."category" OR OLD."userId" IS DISTINCT FROM NEW."userId")
  EXECUTE FUNCTION "sync_record_tombstone"();
