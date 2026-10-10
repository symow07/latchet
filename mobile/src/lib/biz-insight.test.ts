import { describe, expect, it } from 'bun:test';
import { pickBizInsight, type BizInsightInput } from './biz-insight';

const money = (n: number) => `$${n.toFixed(2)}`;

const base: BizInsightInput = {
  pendingCount: 0,
  canReview: true,
  monthlyBudget: 5000,
  approvedSpend: 1200,
  toolMonthly: 0,
  money,
};

describe('pickBizInsight', () => {
  it('leads with the approval queue, and offers to open it', () => {
    const out = pickBizInsight({ ...base, pendingCount: 3 });
    expect(out.key).toBe('pending');
    expect(out.count).toBe(3);
    expect(out.actions).toEqual(['review']);
  });

  it('tells a submitter their own expenses are pending, with nothing to click', () => {
    const out = pickBizInsight({ ...base, pendingCount: 2, canReview: false });
    expect(out.key).toBe('pendingOwn');
    // A submitter cannot approve, so offering "Review them" would be a chip
    // that leads to a queue they are not allowed to act on.
    expect(out.actions).toEqual([]);
  });

  it('puts the queue ahead of going over budget', () => {
    const out = pickBizInsight({ ...base, pendingCount: 1, approvedSpend: 9000 });
    expect(out.key).toBe('pending');
  });

  it('reports going over budget once the queue is clear', () => {
    const out = pickBizInsight({ ...base, approvedSpend: 6200 });
    expect(out.key).toBe('budgetOver');
    expect(out.params.amount).toBe('$1200.00');
  });

  it('does not invent a budget problem when no budget is set', () => {
    expect(pickBizInsight({ ...base, monthlyBudget: 0, approvedSpend: 9000 }).key).toBe('steady');
  });

  it('surfaces tool spend when there is nothing more urgent', () => {
    const out = pickBizInsight({ ...base, toolMonthly: 340 });
    expect(out.key).toBe('toolSpend');
    expect(out.actions).toEqual(['tools']);
  });

  it('stays quiet rather than inventing something to say', () => {
    expect(pickBizInsight(base).key).toBe('steady');
    expect(pickBizInsight(base).actions).toEqual([]);
  });

  it('never offers more than the two chips the layout has room for', () => {
    const cases: BizInsightInput[] = [
      { ...base, pendingCount: 4 },
      { ...base, pendingCount: 4, canReview: false },
      { ...base, approvedSpend: 9000 },
      { ...base, toolMonthly: 200 },
      base,
    ];
    for (const c of cases) expect(pickBizInsight(c).actions.length).toBeLessThanOrEqual(2);
  });
});
