-- Stop retaining raw email headers.
--
-- InboxEmail persisted fromAddr and the full subject line indefinitely, while
-- the privacy policy promised only merchant, amount, currency, cycle and date
-- were kept. Receipt subjects routinely carry order numbers, invoice
-- references and the amount itself.
--
-- Existing values are dropped rather than transformed: the promise was that we
-- would not hold this data, so the remedy is deleting it. Rows keep their
-- parsed subscription fields; `label` starts empty for them and the inbox
-- screen falls back to a generic description.
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_InboxEmail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "senderDomain" TEXT,
    "label" TEXT NOT NULL DEFAULT '',
    "merchant" TEXT,
    "amount" REAL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "cadence" TEXT NOT NULL DEFAULT 'unknown',
    "chargedISO" TEXT,
    "isSubscription" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'parsed',
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InboxEmail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_InboxEmail" ("id", "userId", "merchant", "amount", "currency", "cadence", "chargedISO", "isSubscription", "status", "receivedAt")
SELECT "id", "userId", "merchant", "amount", "currency", "cadence", "chargedISO", "isSubscription", "status", "receivedAt" FROM "InboxEmail";

DROP TABLE "InboxEmail";
ALTER TABLE "new_InboxEmail" RENAME TO "InboxEmail";
CREATE INDEX "InboxEmail_userId_receivedAt_idx" ON "InboxEmail"("userId", "receivedAt");

PRAGMA foreign_keys=ON;
