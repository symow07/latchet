-- Explicit current-business selection, so membership resolution is
-- deterministic for users belonging to more than one business.
ALTER TABLE "UserSettings" ADD COLUMN "activeBusinessId" TEXT;
