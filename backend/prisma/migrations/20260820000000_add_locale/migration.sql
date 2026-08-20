-- UI language, synced so it follows the account rather than the device.
ALTER TABLE "UserSettings" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
