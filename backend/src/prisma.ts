import { PrismaClient } from "@prisma/client";
import { env } from "./env";

// SQLite is a single-writer database. Prisma's default connection pool spawns
// multiple connections that compete for the write lock and hang on SQLITE_BUSY.
// connection_limit=1 eliminates all intra-process lock contention — the single
// root cause of the 10-second signup hang on Railway.
const dbUrl = (() => {
  const base = env.DATABASE_URL;
  if (base.includes("connection_limit")) return base;
  return base.includes("?") ? `${base}&connection_limit=1` : `${base}?connection_limit=1`;
})();

export const prisma = new PrismaClient({
  datasources: { db: { url: dbUrl } },
});

// Pragmas only need to be set once per connection. With connection_limit=1
// there is exactly one connection for the lifetime of the process.
prisma
  .$queryRawUnsafe("PRAGMA journal_mode = WAL;")
  .then(() => prisma.$queryRawUnsafe("PRAGMA foreign_keys = ON;"))
  .then(() => prisma.$queryRawUnsafe("PRAGMA busy_timeout = 3000;"))
  .then(() => prisma.$queryRawUnsafe("PRAGMA synchronous = NORMAL;"))
  .catch((err) => console.error("[prisma] pragma init failed:", err));
