import { prisma } from "../prisma";

function computeNextDate(currentDate: string, frequency: string): string {
  const d = new Date(currentDate + "T00:00:00Z");

  switch (frequency) {
    case "daily":
      d.setUTCDate(d.getUTCDate() + 1);
      break;
    case "weekly":
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case "biweekly":
      d.setUTCDate(d.getUTCDate() + 14);
      break;
    case "monthly":
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    case "yearly":
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      break;
    default:
      d.setUTCMonth(d.getUTCMonth() + 1);
  }

  return d.toISOString().split("T")[0]!;
}

async function processRecurring() {
  const today = new Date().toISOString().split("T")[0]!;

  const dueRecurrences = await prisma.recurringTransaction.findMany({
    where: {
      isActive: true,
      nextDate: { lte: today },
    },
  });

  for (const rec of dueRecurrences) {
    // Idempotency: skip if we already created a transaction for today
    if (rec.lastCreated === today) continue;

    // Deterministic ID prevents duplicates even on re-runs
    const txId = `tx_rec_${rec.id}_${today}`;

    try {
      await prisma.$transaction([
        prisma.transaction.create({
          data: {
            id: txId,
            userId: rec.userId,
            accountId: rec.accountId,
            amount: rec.amount,
            category: rec.category,
            type: rec.type,
            isImpulse: rec.isImpulse,
            note: `[Auto] ${rec.name}`,
            dateISO: today,
            currency: rec.currency,
          },
        }),
        prisma.recurringTransaction.update({
          where: { id: rec.id },
          data: {
            lastCreated: today,
            nextDate: computeNextDate(rec.nextDate, rec.frequency),
          },
        }),
      ]);
    } catch (e: any) {
      // Unique constraint = already created (idempotent), skip
      if (e?.code === "P2002") continue;
      console.error(`[recurring-processor] Failed for ${rec.id}:`, e);
    }
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startRecurringProcessor(intervalMs = 60_000) {
  // Run immediately on start
  processRecurring().catch((e) =>
    console.error("[recurring-processor] Initial run failed:", e)
  );

  // Then repeat on interval
  intervalHandle = setInterval(() => {
    processRecurring().catch((e) =>
      console.error("[recurring-processor] Scheduled run failed:", e)
    );
  }, intervalMs);
  intervalHandle.unref();
}

export function stopRecurringProcessor() {
  if (intervalHandle) clearInterval(intervalHandle);
}
