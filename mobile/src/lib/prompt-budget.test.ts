import { test, expect } from 'bun:test';
import { fitConversationHistory, historyBudget, omissionNote, MAX_PROMPT_CHARS, PROMPT_SAFETY_MARGIN, type ChatTurn, localeInstruction } from './prompt-budget';

const turn = (role: 'user' | 'assistant', content: string): ChatTurn => ({ role, content });

test('a short conversation is kept whole', () => {
  const history = [turn('user', 'hello'), turn('assistant', 'hi there')];
  const fitted = fitConversationHistory(history, 1000);

  expect(fitted.dropped).toBe(0);
  expect(fitted.text).toBe('User: hello\n\nAssistant: hi there');
});

test('older turns are dropped before newer ones', () => {
  const history = [
    turn('user', 'oldest'),
    turn('assistant', 'middle'),
    turn('user', 'newest'),
  ];
  // Room for roughly the last two lines only.
  const fitted = fitConversationHistory(history, 32);

  expect(fitted.text).toContain('newest');
  expect(fitted.text).not.toContain('oldest');
  expect(fitted.dropped).toBeGreaterThan(0);
});

test('the fitted transcript never exceeds its budget', () => {
  const history = Array.from({ length: 200 }, (_, i) =>
    turn(i % 2 === 0 ? 'user' : 'assistant', `message number ${i} `.repeat(20))
  );
  const budget = 5_000;
  const fitted = fitConversationHistory(history, budget);

  expect(fitted.text.length).toBeLessThanOrEqual(budget);
  expect(fitted.dropped).toBeGreaterThan(0);
});

test('turns stay in chronological order after trimming', () => {
  const history = [
    turn('user', 'first'),
    turn('assistant', 'second'),
    turn('user', 'third'),
    turn('assistant', 'fourth'),
  ];
  const fitted = fitConversationHistory(history, 60);
  const lines = fitted.text.split('\n\n');

  const sorted = [...lines].sort(
    (a, b) => history.findIndex(h => a.endsWith(h.content)) - history.findIndex(h => b.endsWith(h.content))
  );
  expect(lines).toEqual(sorted);
});

test('one enormous turn is truncated rather than dropping everything', () => {
  const history = [turn('user', 'x'.repeat(10_000))];
  const fitted = fitConversationHistory(history, 500);

  expect(fitted.text.length).toBeLessThanOrEqual(500);
  expect(fitted.text.startsWith('…')).toBe(true);
});

test('a zero or negative budget keeps nothing', () => {
  const history = [turn('user', 'hello')];
  expect(fitConversationHistory(history, 0)).toEqual({ text: '', dropped: 1 });
  expect(fitConversationHistory(history, -50)).toEqual({ text: '', dropped: 1 });
});

test('an empty history is not an error', () => {
  expect(fitConversationHistory([], 1000)).toEqual({ text: '', dropped: 0 });
});

test('the history budget leaves room for the fixed prompt and a margin', () => {
  expect(historyBudget(0)).toBe(MAX_PROMPT_CHARS - PROMPT_SAFETY_MARGIN);
  expect(historyBudget(5_000)).toBe(MAX_PROMPT_CHARS - PROMPT_SAFETY_MARGIN - 5_000);
  // A fixed section larger than the cap yields no room, not a negative budget
  // that would be mistaken for space.
  expect(historyBudget(MAX_PROMPT_CHARS + 1)).toBeLessThan(0);
});

test('omission is disclosed so the model does not claim to recall dropped turns', () => {
  expect(omissionNote(0)).toBe('');
  expect(omissionNote(1)).toContain('1 earlier message ');
  expect(omissionNote(4)).toContain('4 earlier messages');
  expect(omissionNote(4)).toContain('do not claim to recall');
});

test('a realistic long chat stays under the server cap', () => {
  // 300 turns of a few hundred characters each — far past the old failure point.
  const history = Array.from({ length: 300 }, (_, i) =>
    turn(i % 2 === 0 ? 'user' : 'assistant', `Turn ${i}: ${'spending advice '.repeat(20)}`)
  );
  const systemContext = 'S'.repeat(4_000);
  const userMessage = 'How am I doing this month?';

  const fitted = fitConversationHistory(
    history,
    historyBudget(systemContext.length + userMessage.length)
  );
  const prompt = `${systemContext}\n\nCONVERSATION HISTORY:\n${omissionNote(
    fitted.dropped
  )}${fitted.text}\n\nUser: ${userMessage}\n\nRespond as the AI financial advisor:`;

  expect(prompt.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
});

// ── Reply language ───────────────────────────────────────────────────────────

test('the model is told which language to answer in', () => {
  expect(localeInstruction('fr')).toContain('French');
  expect(localeInstruction('zh')).toContain('Simplified Chinese');
  expect(localeInstruction('en')).toContain('English');
});

test('the instruction overrides the language the user typed in', () => {
  // A French user asking in English should still get French back, because the
  // rest of the app is French.
  expect(localeInstruction('fr')).toContain('whatever language the user writes in');
});

test('category labels are passed through verbatim', () => {
  // The model echoes what it is shown. Given English names it answers with
  // English ones, and the advice then disagrees with every other screen.
  const out = localeInstruction('fr', ['Alimentation', 'Sport', 'Transport']);
  expect(out).toContain('Alimentation');
  expect(out).toContain('Sport');
  expect(out).toContain('use exactly these labels');
});

test('no labels means no label sentence', () => {
  // The no-data branch has no categories to name.
  expect(localeInstruction('fr')).not.toContain('use exactly these labels');
});

test('an unknown locale falls back to English rather than naming nothing', () => {
  expect(localeInstruction('de')).toContain('English');
  expect(localeInstruction('')).toContain('English');
});
