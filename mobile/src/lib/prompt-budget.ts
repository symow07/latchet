/**
 * Keeps the advisor prompt inside the server's limit.
 *
 * POST /api/ai/chat validates `prompt` at 20,000 characters, but the prompt is
 * assembled on-device by buildAIPrompt(), which concatenated the entire
 * conversation history with no bound. A long enough chat therefore pushed the
 * prompt over the cap and the advisor began failing every request — and kept
 * failing, since history only ever grows.
 *
 * Dependency-free so the budgeting can be tested directly.
 */

/** Must match `chatSchema` in backend/src/routes/ai.ts. */
export const MAX_PROMPT_CHARS = 20_000;

/** Headroom for the joining scaffolding and any off-by-a-bit in the estimate. */
export const PROMPT_SAFETY_MARGIN = 500;

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface FittedHistory {
  /** Formatted transcript, oldest to newest, that fits the budget. */
  text: string;
  /** How many older turns had to be dropped. */
  dropped: number;
}

function format(turn: ChatTurn): string {
  return `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.content}`;
}

/**
 * Fit as much recent history as `available` allows.
 *
 * Recency wins: the newest turns are the ones the next reply depends on, so
 * the transcript is filled backwards and older turns are dropped first.
 */
export function fitConversationHistory(
  history: ChatTurn[],
  available: number
): FittedHistory {
  if (available <= 0) return { text: '', dropped: history.length };

  const kept: string[] = [];
  let used = 0;

  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i]!;
    let line = format(turn);

    // A single turn larger than the whole budget still has to yield something,
    // so keep its tail — that's the part nearest the current question.
    if (line.length > available) {
      if (kept.length > 0) break;
      line = `…${line.slice(-(available - 1))}`;
    }

    const cost = line.length + (kept.length > 0 ? 2 : 0); // "\n\n" between turns
    if (used + cost > available) break;

    kept.unshift(line);
    used += cost;
  }

  return { text: kept.join('\n\n'), dropped: history.length - kept.length };
}

/**
 * Characters left for history once the fixed parts of the prompt are counted.
 */
export function historyBudget(fixedLength: number): number {
  return MAX_PROMPT_CHARS - PROMPT_SAFETY_MARGIN - fixedLength;
}

/** Prefix telling the model the transcript is partial, so it doesn't confabulate. */
export function omissionNote(dropped: number): string {
  if (dropped <= 0) return '';
  return `[${dropped} earlier message${dropped === 1 ? '' : 's'} omitted for length — do not claim to recall them]\n\n`;
}

// ── Reply language ───────────────────────────────────────────────────────────

/** How to name each language to the model. */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  fr: 'French',
  zh: 'Simplified Chinese',
};

/**
 * The one localised line in the advisor prompt.
 *
 * Two halves of the same problem: the reply language, and the category names
 * inside it. The model echoes whatever it is shown — given English category
 * names it answers with English ones, and the user then reads "Alimentation"
 * everywhere in the app and "Food" in the advice about it.
 *
 * Only this line is localised. The rest of the system context stays English:
 * it is scaffolding around numeric data, models read it perfectly well, and
 * maintaining three copies of a prompt that changes often would cost more than
 * it returns.
 */
export function localeInstruction(locale: string, categoryLabels: string[] = []): string {
  const language = LANGUAGE_NAMES[locale] ?? LANGUAGE_NAMES.en;
  const labels = categoryLabels.length
    ? ` When naming a spending category, use exactly these labels: ${categoryLabels.join(', ')}.`
    : '';
  return `Reply entirely in ${language}, whatever language the user writes in.${labels}`;
}
