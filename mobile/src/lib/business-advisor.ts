/**
 * Context for the business advisor.
 *
 * Pure and native-free so the wording can be tested exhaustively — this is the
 * half that decides what the model is told about a company, and getting it
 * wrong is how an advisor invents figures.
 *
 * Everything here is FACTUAL and already on screen elsewhere in the app. The
 * advisor's job is to explain and connect those numbers, not to hold data the
 * user cannot otherwise see.
 */

export interface BusinessFacts {
  name?: string | null;
  memberCount?: number | null;
  currency?: string | null;
  budget?: {
    totalMonthly: number;
    byCategory: Record<string, number>;
  } | null;
  spending?: {
    total: number;
    approved: number;
    byCategory: Record<string, number>;
  } | null;
  payroll?: {
    totalPayroll: number;
    paidTotal: number;
    unpaidTotal: number;
  } | null;
  pendingExpenseCount?: number | null;
  monthLabel?: string | null;
}

const money = (n: number, currency: string) => `${currency}${n.toFixed(2)}`;

/**
 * Returns '' when there is nothing factual to say, so the caller can
 * concatenate unconditionally. An advisor given an empty context should say it
 * has no data rather than be handed a heading with nothing under it.
 */
export function buildBusinessContext(facts: BusinessFacts | null | undefined): string {
  if (!facts) return '';
  const cur = (facts.currency ?? '$').slice(0, 3);
  const lines: string[] = [];

  if (facts.name) lines.push(`- Company: ${facts.name}`);
  if (typeof facts.memberCount === 'number' && facts.memberCount > 0) {
    lines.push(`- Team size: ${facts.memberCount}`);
  }
  if (facts.monthLabel) lines.push(`- Period: ${facts.monthLabel}`);

  if (facts.budget && facts.budget.totalMonthly > 0) {
    lines.push(`- Monthly budget: ${money(facts.budget.totalMonthly, cur)}`);
    const cats = Object.entries(facts.budget.byCategory).filter(([, v]) => v > 0);
    if (cats.length > 0) {
      lines.push(`  Budget by category: ${cats.map(([k, v]) => `${k} ${money(v, cur)}`).join(', ')}`);
    }
  }

  if (facts.spending) {
    lines.push(
      `- Spending this period: ${money(facts.spending.total, cur)} submitted, ` +
      `${money(facts.spending.approved, cur)} approved`
    );
    const cats = Object.entries(facts.spending.byCategory).filter(([, v]) => v > 0);
    if (cats.length > 0) {
      lines.push(`  Spend by category: ${cats.map(([k, v]) => `${k} ${money(v, cur)}`).join(', ')}`);
    }
  }

  if (facts.payroll && facts.payroll.totalPayroll > 0) {
    lines.push(
      `- Payroll: ${money(facts.payroll.totalPayroll, cur)} total, ` +
      `${money(facts.payroll.unpaidTotal, cur)} still unpaid`
    );
  }

  if (typeof facts.pendingExpenseCount === 'number' && facts.pendingExpenseCount > 0) {
    lines.push(`- ${facts.pendingExpenseCount} expense(s) awaiting review`);
  }

  if (lines.length === 0) return '';

  return `THIS COMPANY'S FIGURES (all amounts in ${cur}):
${lines.join('\n')}`;
}

/** True when there is nothing to ground an answer in, so the UI can say so. */
export function businessContextIsEmpty(facts: BusinessFacts | null | undefined): boolean {
  return buildBusinessContext(facts) === '';
}

/**
 * The persona. Kept separate from the figures so a change to one cannot
 * silently reword the other.
 *
 * It does NOT restate the safety constraints — those are prepended server-side
 * in lib/advisor-safety.ts, where a client cannot omit them. Repeating them
 * here would imply this half is what enforces them.
 */
export function businessAdvisorPersona(localeInstruction: string): string {
  return `You advise the owner or manager of a small business inside a budgeting app called "Latchet". You talk about the company's money: what it spends, what it owes in payroll, whether it is inside budget, and what to do about it.

Ground every claim in the figures you are given. If a figure you would need is missing, say which one rather than estimating it. Be concrete and brief — two to four short paragraphs.

${localeInstruction}`;
}
