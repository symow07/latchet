/**
 * Learning a category from what the user has already done.
 *
 * When a transaction arrives uncategorised, the user's own history is asked
 * first and the keyword fallback (category-keywords.ts) only after it. No
 * list we ship can know every corner shop in Casablanca or every stall on a
 * WeChat bill, and it cannot know that this user files Starbucks under
 * "Treats" — but the user's own history can, and it is already sitting in the
 * database. Categorise Carrefour once and every future Carrefour row fills
 * itself in, whatever the keyword table would have said.
 *
 * Three rules keep it from being annoying:
 *
 *   - The longest matching prefix wins, so "Uber Eats" is Food even when
 *     "Uber" is Transport. Without that, one token would swallow the other and
 *     the suggestion would be wrong in a way the user has to keep undoing.
 *   - An ambiguous history suggests nothing. If Carrefour is Food six times
 *     and Shopping five, there is no answer worth pre-filling, and guessing
 *     costs the user more than leaving it blank.
 *   - Thin history is not ambiguity. One old choice and one new one is a mind
 *     changed, not a coin flip, so the newer wins — see ENOUGH_TO_JUDGE.
 *
 * Dependency-free so the matching can be tested without a database.
 */

/**
 * Bank statements bury the merchant in reference numbers and card fragments,
 * and French and Moroccan ones open most lines with the same boilerplate
 * ("PAIEMENT CB", "ACHAT TPE", "PRLV SEPA"). Left in, that prefix would be the
 * key every card payment shares, and the memory would file them all alike.
 */
const NOISE = new Set([
  'the', 'and', 'ltd', 'llc', 'inc', 'sarl', 'sa', 'co', 'company',
  'card', 'visa', 'mastercard', 'pos', 'purchase', 'payment', 'debit',
  'credit', 'transaction', 'ref', 'no', 'nr', 'txn', 'auth', 'contactless',
  'cb', 'carte', 'paiement', 'par', 'achat', 'tpe', 'prlv', 'sepa', 'facture',
  'fact', 'sans', 'contact',
]);

/** How many leading tokens form the longest key we will remember. */
const MAX_KEY_TOKENS = 3;

/** Below this share of a merchant's history, the answer is not clear enough. */
const CONFIDENCE = 0.6;

/**
 * How much history is needed before a split counts as inconsistency.
 *
 * Below this, a split is not evidence that the user is undecided — it is more
 * likely they changed their mind, and the newer choice is the better guess.
 * Netflix filed under Entertainment in January and Subscriptions in August is
 * one decision superseding another, not a coin flip. Above it, genuinely
 * interleaved use means no answer is worth pre-filling.
 */
const ENOUGH_TO_JUDGE = 4;

export interface MerchantEntry {
  category: string;
  /** Times this category was chosen for this key. */
  count: number;
  /** Times the key was seen at all, across every category. */
  total: number;
  /** Most recent date the winning category was used, for tie-breaking. */
  lastISO: string;
}

export type MerchantMemory = Map<string, MerchantEntry>;

/** Significant, lowercased words from a description, noise and digits removed. */
export function merchantTokens(note: string): string[] {
  return String(note ?? '')
    .toLowerCase()
    // keep letters from any script — Latin, Arabic, Han — drop everything else
    .replace(/[^\p{L}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !NOISE.has(w));
}

/**
 * The keys a description contributes to, longest first.
 *
 * "Uber Eats lunch" yields ["uber eats lunch", "uber eats", "uber"], so a
 * later "Uber Eats" lookup can match the two-token key while a plain "Uber"
 * ride still matches the one-token key.
 */
export function merchantKeys(note: string): string[] {
  const words = merchantTokens(note).slice(0, MAX_KEY_TOKENS);
  const keys: string[] = [];
  for (let n = words.length; n >= 1; n--) keys.push(words.slice(0, n).join(' '));
  return keys;
}

interface Tally {
  byCategory: Map<string, { count: number; lastISO: string }>;
  total: number;
}

export interface LearnableTransaction {
  note?: string | null;
  category?: string | null;
  dateISO?: string | null;
}

/**
 * Build the lookup table from transactions the user has already categorised.
 *
 * Rows left on the fallback category teach nothing — "Other" usually means the
 * user did not choose, so counting it would train the memory to suggest the
 * absence of a decision.
 */
export function buildMerchantMemory(
  transactions: readonly LearnableTransaction[],
  fallbackCategory = 'Other',
): MerchantMemory {
  const tallies = new Map<string, Tally>();

  for (const tx of transactions) {
    const category = (tx.category ?? '').trim();
    if (!category || category === fallbackCategory) continue;
    const dateISO = tx.dateISO ?? '';

    for (const key of merchantKeys(tx.note ?? '')) {
      let tally = tallies.get(key);
      if (!tally) {
        tally = { byCategory: new Map(), total: 0 };
        tallies.set(key, tally);
      }
      tally.total += 1;
      const seen = tally.byCategory.get(category);
      if (!seen) {
        tally.byCategory.set(category, { count: 1, lastISO: dateISO });
      } else {
        seen.count += 1;
        if (dateISO > seen.lastISO) seen.lastISO = dateISO;
      }
    }
  }

  const memory: MerchantMemory = new Map();
  for (const [key, tally] of tallies) {
    let best: { category: string; count: number; lastISO: string } | null = null;
    for (const [category, { count, lastISO }] of tally.byCategory) {
      if (
        !best ||
        count > best.count ||
        // A tie goes to whichever the user chose most recently: tastes change,
        // and the newer decision is the better guess at the current one.
        (count === best.count && lastISO > best.lastISO)
      ) {
        best = { category, count, lastISO };
      }
    }
    if (best) memory.set(key, { ...best, total: tally.total });
  }
  return memory;
}

/**
 * The category to pre-fill for a description, or null to leave it alone.
 *
 * Null is a real answer. A blank field costs the user one tap; a confident
 * wrong answer costs them noticing it, undoing it, and trusting the next one
 * less.
 */
export function suggestCategory(note: string, memory: MerchantMemory): string | null {
  for (const key of merchantKeys(note)) {
    const entry = memory.get(key);
    if (!entry) continue;
    const share = entry.count / entry.total;
    if (share < CONFIDENCE && entry.total >= ENOUGH_TO_JUDGE) {
      // Seen enough times to know the user really is inconsistent here. A
      // shorter key is even less specific, so stop rather than widening.
      return null;
    }
    // Either a clear majority, or too little history to call it inconsistent —
    // in which case buildMerchantMemory has already broken the tie by recency.
    return entry.category;
  }
  return null;
}
