-- Company logo.
--
-- Holds a path this backend serves (`/api/business/logo`), never an arbitrary
-- URL: a stored remote address would be fetched by every client that renders
-- the company, which hands whoever set it a view of every viewer.
ALTER TABLE "Business" ADD COLUMN "logoUrl" TEXT;
