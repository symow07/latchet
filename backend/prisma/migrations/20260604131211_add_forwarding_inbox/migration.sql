-- CreateTable
CREATE TABLE "InboxEmail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "fromAddr" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
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

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EmailConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'gmail',
    "email" TEXT NOT NULL,
    "refreshTokenEnc" TEXT,
    "inboundToken" TEXT,
    "forwardingVerified" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastScanAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EmailConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_EmailConnection" ("createdAt", "email", "id", "lastScanAt", "provider", "refreshTokenEnc", "status", "updatedAt", "userId") SELECT "createdAt", "email", "id", "lastScanAt", "provider", "refreshTokenEnc", "status", "updatedAt", "userId" FROM "EmailConnection";
DROP TABLE "EmailConnection";
ALTER TABLE "new_EmailConnection" RENAME TO "EmailConnection";
CREATE UNIQUE INDEX "EmailConnection_inboundToken_key" ON "EmailConnection"("inboundToken");
CREATE UNIQUE INDEX "EmailConnection_userId_email_key" ON "EmailConnection"("userId", "email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "InboxEmail_userId_receivedAt_idx" ON "InboxEmail"("userId", "receivedAt");
