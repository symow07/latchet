-- Remove the Gmail OAuth path from EmailConnection.
--
-- Gmail connections (encrypted refresh tokens, no forwarding token) are
-- deleted outright; forwarding inboxes are kept. Then the table is redefined
-- without refreshTokenEnc, status and lastScanAt, which only Gmail used,
-- and provider defaults to 'forwarding'.
DELETE FROM "EmailConnection" WHERE "provider" = 'gmail' AND "inboundToken" IS NULL;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EmailConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'forwarding',
    "email" TEXT NOT NULL,
    "inboundToken" TEXT,
    "forwardingVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EmailConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_EmailConnection" ("createdAt", "email", "forwardingVerified", "id", "inboundToken", "provider", "updatedAt", "userId") SELECT "createdAt", "email", "forwardingVerified", "id", "inboundToken", "provider", "updatedAt", "userId" FROM "EmailConnection";
DROP TABLE "EmailConnection";
ALTER TABLE "new_EmailConnection" RENAME TO "EmailConnection";
CREATE UNIQUE INDEX "EmailConnection_inboundToken_key" ON "EmailConnection"("inboundToken");
CREATE UNIQUE INDEX "EmailConnection_userId_email_key" ON "EmailConnection"("userId", "email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
