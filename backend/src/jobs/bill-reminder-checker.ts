import { prisma } from "../prisma";

function advanceMonth(dateStr: string, dueDay: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  // Clamp dueDay to last day of month (e.g., 31 → 28 for Feb)
  const lastDay = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)
  ).getUTCDate();
  d.setUTCDate(Math.min(dueDay, lastDay));
  return d.toISOString().split("T")[0];
}

async function checkBillReminders() {
  const today = new Date().toISOString().split("T")[0];

  const dueReminders = await prisma.billReminder.findMany({
    where: {
      isPaid: false,
      nextDueDate: { lte: today },
    },
  });

  for (const bill of dueReminders) {
    // TODO: Send push notification / email here
    // For now, log the due bill for observability
    console.log(
      `[bill-reminder] Due: "${bill.name}" — $${bill.amount} (user: ${bill.userId})`
    );

    // If recurring, advance to next month's due date
    if (bill.isRecurring) {
      const nextDueDate = advanceMonth(bill.nextDueDate, bill.dueDay);
      await prisma.billReminder.update({
        where: { id: bill.id },
        data: { nextDueDate, isPaid: false },
      });
    }
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startBillReminderChecker(intervalMs = 5 * 60_000) {
  // Run immediately
  checkBillReminders().catch((e) =>
    console.error("[bill-reminder] Initial run failed:", e)
  );

  // Then repeat on interval
  intervalHandle = setInterval(() => {
    checkBillReminders().catch((e) =>
      console.error("[bill-reminder] Scheduled run failed:", e)
    );
  }, intervalMs);
  intervalHandle.unref();
}

export function stopBillReminderChecker() {
  if (intervalHandle) clearInterval(intervalHandle);
}
