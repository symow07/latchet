/**
 * SYNTHETIC data for the Phase 2a identity sample (src/app/identity-preview.tsx).
 *
 * Invented so the sample can be judged signed out on a fresh simulator. These
 * are the shapes the real Home reads from the ledger: stored category keys
 * (rendered through categoryLabel), ISO dates (rendered through date-fns in the
 * user's locale) and merchant notes as the user typed them. Nothing here is a
 * real figure, and nothing outside the sample imports it.
 */
import type { GlyphName } from './glyph-paths';

export interface DemoTransaction {
  id: string;
  note: string;
  /** A stored category key, as the ledger holds it. */
  category: string;
  /** Days before today. */
  daysAgo: number;
  /** Signed: positive is money in. */
  amount: number;
  glyph: GlyphName;
}

export const DEMO = {
  name: 'Sam',
  balance: 12480.35,
  accounts: 3,
  budget: 3050,
  spent: 1765.5,
  saving: 420,
  recent: [
    { id: '1', note: 'Carrefour Market', category: 'Food', daysAgo: 0, amount: -64.2, glyph: 'bag' },
    { id: '2', note: 'Café Kitsuné', category: 'Food', daysAgo: 0, amount: -4.8, glyph: 'cup' },
    { id: '3', note: 'Uber', category: 'Transport', daysAgo: 1, amount: -12.4, glyph: 'car' },
    { id: '4', note: 'Salary', category: 'Salary', daysAgo: 1, amount: 2850, glyph: 'income' },
    { id: '5', note: 'Netflix', category: 'Subscriptions', daysAgo: 2, amount: -13.49, glyph: 'repeat' },
  ] as DemoTransaction[],
};
