/**
 * The business counterpart to home-insight.
 *
 * DESIGN-PROMPT.md §32 asks business home to be "the direct counterpart" to
 * personal home, and lists six things for it: greeting, approved-total card,
 * one budget line, one insight, a pending-approval count, recent expenses.
 * That is four content blocks, and §4 allows three.
 *
 * The count is not cut — it is what the insight is *about*. For someone who
 * can approve, "three expenses are waiting for your review" is the single most
 * actionable sentence the screen can open with, which is exactly the job §5
 * gives the insight. So the count becomes the insight's subject when there is
 * one, and the screen stays inside the density budget without losing anything.
 *
 * Returns a key and its parameters rather than a string, so this file stays
 * free of any i18n or native import and can be unit-tested.
 */

/** What a chip beneath the business insight does. */
export type BizInsightAction = 'review' | 'tools' | 'setBudget';

export interface BizInsight {
  /** Key under `bizHome` in the locale files. */
  key: string;
  params: Record<string, string | number>;
  actions: BizInsightAction[];
  /** Plural key, when the sentence counts something. */
  count?: number;
}

export interface BizInsightInput {
  pendingCount: number;
  /** Owners and managers see the queue; everyone else sees only their own. */
  canReview: boolean;
  monthlyBudget: number;
  approvedSpend: number;
  /** Detected recurring tool spend per month. Zero when nothing is detected. */
  toolMonthly: number;
  money: (n: number) => string;
}

export function pickBizInsight(input: BizInsightInput): BizInsight {
  const { pendingCount, canReview, monthlyBudget, approvedSpend, toolMonthly, money } = input;

  // A queue someone can clear outranks everything else on the screen.
  if (pendingCount > 0) {
    return canReview
      ? { key: 'pending', params: { count: pendingCount }, count: pendingCount, actions: ['review'] }
      : { key: 'pendingOwn', params: { count: pendingCount }, count: pendingCount, actions: [] };
  }

  if (monthlyBudget > 0 && approvedSpend > monthlyBudget) {
    return {
      key: 'budgetOver',
      params: { amount: money(approvedSpend - monthlyBudget), budget: money(monthlyBudget) },
      actions: ['setBudget'],
    };
  }

  if (toolMonthly > 0) {
    return { key: 'toolSpend', params: { amount: money(toolMonthly) }, actions: ['tools'] };
  }

  return { key: 'steady', params: {}, actions: [] };
}
