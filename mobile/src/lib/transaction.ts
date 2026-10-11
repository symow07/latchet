/**
 * The one Transaction type in the app.
 *
 * It used to be declared three times (calculations, ai-analysis,
 * behavior-detection — plus copies in health-score and the activity screen),
 * identically and wrongly: `isImpulse: number`, a SQLite storage detail leaking
 * into every calculation, and no `accountId` or `currency`, which the table had
 * all along.
 *
 * This is the shape of the server's Prisma `Transaction` model
 * (backend/prisma/schema.prisma) without its server-only columns — userId,
 * the relations, updatedAt and the two sync timestamps. transaction.test.ts
 * reads that schema and fails if the two drift apart. SQLite's 0/1 and NULL
 * are converted to boolean and null at one boundary, in db.ts; nothing above
 * it ever sees an integer isImpulse.
 */
export interface Transaction {
  id: string;
  amount: number;
  category: string;
  type: 'Expense' | 'Income';
  isImpulse: boolean;
  note: string | null;
  dateISO: string;
  createdAt: string;
  accountId: string | null;
  currency: string;
}

export type TransactionType = Transaction['type'];
