import { PrismaClient } from "@prisma/client";
import { env } from "./env";
import { withDefaultUser } from "./lib/database-url";

// A plain pooled client. Pool size comes from DATABASE_URL: `connection_limit`
// when the URL sets one, Prisma's default (2 × CPUs + 1) otherwise.
//
// This file used to cap the pool at a single connection and set four PRAGMAs
// (WAL, foreign_keys, busy_timeout, synchronous). The server then ran on a
// single-file database that allows one writer at a time: Prisma's pooled
// connections competed for its write lock and hung on a busy error, which was
// the 10-second signup hang on Railway, and one connection was the cure.
// Postgres has no such lock to fight over. Writers lock rows, foreign keys are
// always enforced and nothing is set per connection, while a single connection
// would now queue every request in the process behind one socket. Do not bring
// the one-connection cap back to fix contention; find the transaction that is
// holding locks instead.
export const prisma = new PrismaClient({
  datasources: { db: { url: withDefaultUser(env.DATABASE_URL) } },
});
