-- Phase 6: automatic subscription and trial detection (I-SCHEMA in
-- .unlazy/phase6/PLAN.md).
--
--   EmailConnection  one mailbox per row again: forwarding, and now Gmail and
--                    Outlook read over OAuth (encrypted refresh token, sync
--                    cursors, status and counters).
--   EmailOAuthGrant  every user who ever granted a mailbox provider access.
--                    No foreign key to User: Google's cap on an unverified app
--                    counts users over its lifetime, so the row must survive
--                    the account's deletion.
--   InboxEmail       one email finding from any source: which connection it
--                    came from (deleting the connection deletes them), a
--                    per-user key so one message is stored once, its kind,
--                    dates and confidence. `currency` loses its 'USD' default
--                    and may be null: a currency the email does not state
--                    stays unknown rather than becoming dollars.
--   Subscription     (synced) the user's decision beside the engine's status,
--                    and what detection found: trial end, last price change,
--                    an alert, every source that saw it, where it is billed.
--
-- Triggers: nothing to add. Subscription's two triggers from the init
-- migration are table-level — "Subscription_stamp_serverUpdatedAt" fires
-- BEFORE INSERT OR UPDATE of any column, and "Subscription_tombstone" AFTER
-- DELETE keyed by "syncId" — so the new columns are stamped and tombstoned
-- like the old ones. The email tables are not synced and carry none.

-- ─── EmailConnection ─────────────────────────────────────────────────────────
-- Existing rows are forwarding inboxes: active, idle, nothing scanned yet.

ALTER TABLE "EmailConnection" ADD COLUMN     "backfillCursor" TEXT,
ADD COLUMN     "backfillDoneAt" TIMESTAMP(3),
ADD COLUMN     "findingsCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "messagesScanned" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refreshTokenEnc" TEXT,
ADD COLUMN     "scope" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN     "syncCursor" TEXT,
ADD COLUMN     "syncState" TEXT NOT NULL DEFAULT 'idle';

-- ─── EmailOAuthGrant ─────────────────────────────────────────────────────────

CREATE TABLE "EmailOAuthGrant" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "userKey" TEXT NOT NULL,
    "firstGrantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailOAuthGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailOAuthGrant_provider_userKey_key" ON "EmailOAuthGrant"("provider", "userKey");

-- ─── InboxEmail ──────────────────────────────────────────────────────────────
-- Existing rows are forwarded emails read by the old parser: source
-- 'forwarding', kind 'other', parser 'rules', confidence 0. Their currency is
-- kept as stored; only new rows may leave it null.

ALTER TABLE "InboxEmail" ADD COLUMN     "billedVia" TEXT,
ADD COLUMN     "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "connectionId" TEXT,
ADD COLUMN     "emailDateISO" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'other',
ADD COLUMN     "messageKey" TEXT,
ADD COLUMN     "nextChargeISO" TEXT,
ADD COLUMN     "parser" TEXT NOT NULL DEFAULT 'rules',
ADD COLUMN     "previousAmount" DOUBLE PRECISION,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'forwarding',
ADD COLUMN     "trialEndsISO" TEXT,
ALTER COLUMN "currency" DROP NOT NULL,
ALTER COLUMN "currency" DROP DEFAULT;

-- Every existing finding arrived through its user's forwarding inbox (the
-- only source there was). Link it to that inbox, so disconnecting forwarding
-- deletes it with the rest, as it does for anything forwarded from now on.
-- A finding whose user has no forwarding inbox any more stays unlinked.
UPDATE "InboxEmail" AS e
   SET "connectionId" = (
     SELECT c."id" FROM "EmailConnection" AS c
      WHERE c."userId" = e."userId" AND c."provider" = 'forwarding'
      ORDER BY c."createdAt", c."id"
      LIMIT 1
   )
 WHERE e."connectionId" IS NULL;

CREATE INDEX "InboxEmail_connectionId_idx" ON "InboxEmail"("connectionId");

-- Existing rows have no messageKey (NULLs never collide), so this holds at once.
CREATE UNIQUE INDEX "InboxEmail_userId_messageKey_key" ON "InboxEmail"("userId", "messageKey");

ALTER TABLE "InboxEmail" ADD CONSTRAINT "InboxEmail_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "EmailConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Subscription ────────────────────────────────────────────────────────────

ALTER TABLE "Subscription" ADD COLUMN     "alert" TEXT,
ADD COLUMN     "billedVia" TEXT,
ADD COLUMN     "canceledAt" TEXT,
ADD COLUMN     "decision" TEXT,
ADD COLUMN     "previousAmount" DOUBLE PRECISION,
ADD COLUMN     "priceChangedAt" TEXT,
ADD COLUMN     "sources" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "trialEndsAt" TEXT;

-- Phase 5 kept the user's choice in `status`: confirmed was "keep it",
-- canceled "I cancelled it". Both become the decision, and the status keeps
-- following it. When the user cancelled is not known, so canceledAt stays
-- null. Every source so far is the one `source` names.
--
-- clientUpdatedAt is left alone, so last-writer-wins still sees each row's
-- real last edit. serverUpdatedAt moves (the stamp trigger fires on every
-- updated row), which is what sends every subscription to every phone again
-- with its new fields.
UPDATE "Subscription"
   SET "decision" = CASE "status" WHEN 'confirmed' THEN 'keep' WHEN 'canceled' THEN 'cancel' END,
       "sources" = "source";
