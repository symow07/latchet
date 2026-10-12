-- Phase 5 decision 1: each user's time zone, reported by their phone
-- (PUT /api/v1/me/timezone) and validated as an IANA name there. The server's
-- "today" for a user is their local date in it: recurring bookings (occurrence
-- id, dateISO, lastCreated, nextDate) and bill reminders. NULL, every existing
-- row until its phone reports, means UTC: what every user got before.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "timezone" TEXT;
