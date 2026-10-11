import { describe, expect, test } from 'bun:test';
import {
  canReviewExpense,
  pendingForViewer,
  reviewBlock,
  reviewNote,
  type ReviewableExpense,
} from './expense-review';
import { toolsOverview, type DetectedSubscription } from './business-subscription-detection';
import { overdueBillCount } from './behavior-detection';
import type { Expense } from './expenseApi';

const OWNER = 'u_owner';
const MANAGER = 'u_manager';
const EMPLOYEE = 'u_employee';

const expense = (submitterId: string, status = 'pending'): ReviewableExpense => ({
  status,
  submitterId,
  submitter: { id: submitterId },
});

describe('who may review a business expense', () => {
  test('own expense: an owner or a manager is never offered review on what they submitted', () => {
    // The server answers 403 "Cannot approve your own expense"; the screen
    // used to offer the button anyway.
    expect(canReviewExpense(expense(OWNER), OWNER, 'owner')).toBe(false);
    expect(canReviewExpense(expense(MANAGER), MANAGER, 'manager')).toBe(false);
    expect(reviewBlock(expense(OWNER), OWNER, 'owner')).toBe('ownExpense');
    // Someone else's pending expense is theirs to review.
    expect(canReviewExpense(expense(EMPLOYEE), OWNER, 'owner')).toBe(true);
    expect(canReviewExpense(expense(OWNER), MANAGER, 'manager')).toBe(true);
    expect(canReviewExpense(expense(MANAGER), OWNER, 'owner')).toBe(true);
  });

  test('own expense or not, a member (employee) is never offered review', () => {
    expect(canReviewExpense(expense(OWNER), EMPLOYEE, 'employee')).toBe(false);
    expect(canReviewExpense(expense(EMPLOYEE), EMPLOYEE, 'employee')).toBe(false);
    expect(reviewBlock(expense(OWNER), EMPLOYEE, 'employee')).toBe('notApprover');
    // Not in the business at all, or the business not loaded yet.
    expect(canReviewExpense(expense(OWNER), EMPLOYEE, undefined)).toBe(false);
    expect(canReviewExpense(expense(OWNER), EMPLOYEE, 'admin')).toBe(false);
  });

  test('own expense rules aside, only a pending expense is offered, and only to someone signed in', () => {
    expect(canReviewExpense(expense(EMPLOYEE, 'approved'), OWNER, 'owner')).toBe(false);
    expect(canReviewExpense(expense(EMPLOYEE, 'rejected'), OWNER, 'owner')).toBe(false);
    expect(canReviewExpense(expense(EMPLOYEE), undefined, 'owner')).toBe(false);
    expect(canReviewExpense(expense(EMPLOYEE), null, 'owner')).toBe(false);
    // The nested submitter alone is enough to recognise your own expense.
    expect(canReviewExpense({ status: 'pending', submitter: { id: OWNER } }, OWNER, 'owner')).toBe(false);
  });

  test('own expense: the card says who it is waiting for instead of showing the buttons', () => {
    // An approver's own expense waits for another approver.
    expect(reviewNote(expense(OWNER), OWNER, 'owner')).toBe('waitingForOther');
    expect(reviewNote(expense(MANAGER), MANAGER, 'manager')).toBe('waitingForOther');
    // An employee's, or anyone's seen by an employee, waits for the owner or a manager.
    expect(reviewNote(expense(EMPLOYEE), EMPLOYEE, 'employee')).toBe('waitingForApprover');
    expect(reviewNote(expense(OWNER), EMPLOYEE, 'employee')).toBe('waitingForApprover');
    // Nothing to say when the buttons are there, or the expense is settled.
    expect(reviewNote(expense(EMPLOYEE), OWNER, 'owner')).toBeNull();
    expect(reviewNote(expense(OWNER, 'approved'), OWNER, 'owner')).toBeNull();
  });

  test('own expense: Business Home counts only what waits on the viewer, and theirs apart', () => {
    const all = [
      expense(OWNER),
      expense(OWNER),
      expense(MANAGER),
      expense(EMPLOYEE),
      expense(EMPLOYEE, 'approved'),
      expense(OWNER, 'rejected'),
    ];
    // The owner reviews the manager's and the employee's; their own two wait.
    expect(pendingForViewer(all, OWNER, 'owner')).toEqual({ toReview: 2, mine: 2 });
    // The manager reviews the owner's two and the employee's.
    expect(pendingForViewer(all, MANAGER, 'manager')).toEqual({ toReview: 3, mine: 1 });
    // The employee reviews nothing and has one waiting.
    expect(pendingForViewer(all, EMPLOYEE, 'employee')).toEqual({ toReview: 0, mine: 1 });
    // An owner whose only pending expenses are their own has nothing to review.
    expect(pendingForViewer([expense(OWNER)], OWNER, 'owner')).toEqual({ toReview: 0, mine: 1 });
  });
});

// Business Tools reads the same expenses; its monthly figure lives in
// business-subscription-detection.ts.
describe('business tools: a monthly figure per tool', () => {
  let seq = 0;
  const charge = (description: string, amount: number, dateISO: string): Expense => {
    seq += 1;
    const at = `${dateISO}T10:00:00.000Z`;
    return {
      id: `ex${seq}`,
      businessId: 'biz1',
      submitterId: 'u1',
      reviewerId: null,
      amount,
      category: 'Software',
      description,
      imageUrl: null,
      status: 'approved',
      submittedAt: at,
      reviewedAt: null,
      createdAt: at,
      updatedAt: at,
      submitter: { id: 'u1', name: 'Sam', email: 'sam@example.test' },
      reviewer: null,
    };
  };
  const NOW = new Date(2026, 7, 15, 12, 0, 0); // Saturday 15 August 2026, local noon

  test('a yearly tool adds a twelfth of its price to the month, not all of it', () => {
    const expenses = [
      charge('Slack', 8.75, '2026-06-20'),
      charge('Slack', 8.75, '2026-07-20'),
      charge('Notion', 120, '2024-09-20'),
      charge('Notion', 120, '2025-09-20'),
    ];
    const view = toolsOverview(expenses, [], NOW);
    expect(view.tools.map((s) => [s.name, s.amount])).toEqual([
      ['Notion', 120],
      ['Slack', 8.75],
    ]);
    const notion = view.tools.find((s) => s.name === 'Notion')!;
    expect(view.monthlyByKey[notion.key]).toBeCloseTo(10, 10);
    // The screen used to sum each tool's charge: 128.75 a month.
    expect(view.monthlyTotal).toBeCloseTo(8.75 + 10, 10);
  });

  test('a weekly tool counts 365/12/7 charges a month, an irregular one none', () => {
    const view = toolsOverview(
      [
        charge('Car Wash', 9, '2026-07-25'),
        charge('Car Wash', 9, '2026-08-01'),
        charge('Car Wash', 9, '2026-08-08'),
        ...['2026-05-01', '2026-05-04', '2026-06-23', '2026-07-05'].map((d) => charge('Office Depot', 40, d)),
      ],
      [],
      NOW
    );
    expect(view.monthlyTotal).toBeCloseTo((9 * 365) / 12 / 7, 10);
    const depot = view.tools.find((s) => s.name === 'Office Depot')!;
    expect(depot.isRecurring).toBe(false);
    expect(view.monthlyByKey[depot.key]).toBe(0);
  });

  test('an email-found tool is already per month, and one found both ways counts once', () => {
    const fromEmail = (name: string, monthly: number): DetectedSubscription => ({
      key: `sub_${name.toLowerCase()}`,
      name,
      amount: monthly,
      category: 'Software',
      lastChargeDate: '2026-08-01',
      nextChargeDate: '2026-09-01',
      isRecurring: true,
      monthlyCount: 1,
      cancelInstructions: '',
    });
    const view = toolsOverview(
      [charge('Slack', 8.75, '2026-06-20'), charge('Slack', 8.75, '2026-07-20')],
      [fromEmail('Slack', 8.75), fromEmail('Figma', 15)],
      NOW
    );
    expect(view.tools.map((s) => s.name)).toEqual(['Figma', 'Slack']);
    expect(view.monthlyTotal).toBeCloseTo(8.75 + 15, 10);
  });

  test('upcoming runs from today to 30 days ahead, today included', () => {
    const view = toolsOverview(
      [
        charge('Linear', 8, '2026-06-15'),
        charge('Linear', 8, '2026-07-15'), // next 15 Aug: today
        charge('Figma', 12, '2026-06-14'),
        charge('Figma', 12, '2026-07-14'), // next 14 Aug: overdue
      ],
      [],
      NOW
    );
    // The screen compared midnight with the current time, so a charge due
    // today had already dropped out of "upcoming" by the morning.
    expect(view.upcoming.map((s) => s.name)).toEqual(['Linear']);
  });
});

// Bill Reminders' anchor; the rule lives with the other alerts in
// behavior-detection.ts.
describe('bill reminders: overdue', () => {
  const bill = (nextDueDate: string, isPaid = false) => ({ nextDueDate, isPaid });

  test('a bill due today is due, not overdue; only a past date is', () => {
    expect(overdueBillCount([bill('2026-10-12')], '2026-10-12')).toBe(0);
    expect(overdueBillCount([bill('2026-10-11')], '2026-10-12')).toBe(1);
    expect(overdueBillCount([bill('2026-10-13')], '2026-10-12')).toBe(0);
    expect(
      overdueBillCount([bill('2026-10-12'), bill('2026-09-30'), bill('2026-10-01')], '2026-10-12')
    ).toBe(2);
  });

  test('a paid bill is never overdue', () => {
    expect(overdueBillCount([bill('2026-10-01', true)], '2026-10-12')).toBe(0);
  });
});
