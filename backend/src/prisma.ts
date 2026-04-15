import { PrismaClient } from "@prisma/client";

const basePrisma = new PrismaClient();

async function initSqlitePragmas() {
  await basePrisma.$queryRawUnsafe("PRAGMA journal_mode = WAL;");
  await basePrisma.$queryRawUnsafe("PRAGMA foreign_keys = ON;");
  await basePrisma.$queryRawUnsafe("PRAGMA busy_timeout = 10000;");
  await basePrisma.$queryRawUnsafe("PRAGMA synchronous = NORMAL;");
}
initSqlitePragmas();

// Wrap every Prisma query with timing logs so Railway logs show exactly which
// DB operation is hanging. This is diagnostic instrumentation — remove once
// the root cause is confirmed.
export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ operation, model, args, query }) {
        const t0 = Date.now();
        console.log(`[db:start] ${model}.${operation}`);
        try {
          const result = await query(args);
          console.log(`[db:done] ${model}.${operation} in ${Date.now() - t0}ms`);
          return result;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[db:error] ${model}.${operation} in ${Date.now() - t0}ms: ${msg}`);
          throw err;
        }
      },
    },
  },
});
