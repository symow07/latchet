import { prisma } from "../prisma";
import { sendPushToUser } from "../lib/expo-push";

export function advanceMonth(dateStr: string, dueDay: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  // Compute the target year/month directly. Using setUTCMonth(+1) on a 31st
  // would overflow a short month (Jan 31 → "Feb 31" → Mar 3) and skip the
  // month entirely, so we never mutate the day before clamping.
  const nextMonthIndex = d.getUTCMonth() + 1;
  const targetYear = d.getUTCFullYear() + Math.floor(nextMonthIndex / 12);
  const targetMonth = nextMonthIndex % 12;
  // Clamp dueDay to the last day of the target month (e.g., 31 → 28 for Feb).
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(dueDay, lastDay);
  return new Date(Date.UTC(targetYear, targetMonth, day)).toISOString().split("T")[0]!;
}

async function checkBillReminders() {
  const today = new Date().toISOString().split("T")[0]!;

  const dueReminders = await prisma.billReminder.findMany({
    where: {
      isPaid: false,
      nextDueDate: { lte: today },
    },
  });

  for (const bill of dueReminders) {
    console.log(
      `[bill-reminder] Due: "${bill.name}" — $${bill.amount} (user: ${bill.userId})`
    );

    // Deliver a push to all of the user's registered devices (best-effort).
    await sendPushToUser(
      bill.userId,
      "Bill due 💸",
      `"${bill.name}" — $${bill.amount} is due today.`,
      { type: "bill-reminder", billId: bill.id }
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
