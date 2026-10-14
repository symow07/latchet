/**
 * Onboarding's record for the signed-in user: whether it is done, where it
 * stands while it is not (the step and the answers, saved as the user goes,
 * so a reopened app resumes at the same step), what was passed over at
 * Connect your data (Home's getting-started checklist), and whether that
 * checklist was hidden.
 *
 * One per-user key (storage-keys.ts), so it goes with the user on sign-out.
 * The rules take their storage as an argument (createOnboardingStore), so
 * onboarding-storage.test.ts runs them without a device; the app's instance
 * at the bottom imports AsyncStorage lazily.
 */
import { resumeProgress, SOURCE_IDS, type OnboardingAnswers, type OnboardingProgress, type SourceId } from './onboarding-flow';
import { userKey } from './storage-keys';

const ONBOARDING_KEY = '@latchet_onboarding';
/** subscription-detection.ts's record of statement imports (time spans only). */
const IMPORT_BATCHES_KEY = 'imported_batches_v1';

/**
 * What is stored. An account onboarded by an earlier build has its answers
 * here too (monthlyIncome, currency…); nothing reads them any more — the
 * settings row holds the truth. A returning account restored on a new phone
 * has only the flag (returning-account.ts).
 */
export interface StoredOnboarding {
  completed: boolean;
  /** While onboarding is under way. */
  progress?: OnboardingProgress;
  /** What was passed over at Connect; absent for an account onboarded before it was recorded. */
  skippedSources?: SourceId[];
  /** Home's getting-started checklist was hidden. */
  checklistDismissed?: boolean;
  [legacy: string]: unknown;
}

export interface OnboardingState {
  completed: boolean;
  inProgress: boolean;
}

/** One user's record, opened for one read-modify-write. */
export interface RecordHandle {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

export interface OnboardingStore {
  read(): Promise<StoredOnboarding | null>;
  state(): Promise<OnboardingState>;
  /** The saved progress, as it resumes; null when there is none or onboarding is done. */
  progress(): Promise<OnboardingProgress | null>;
  saveProgress(progress: OnboardingProgress): Promise<void>;
  /** Onboarding finished: the progress goes, what was skipped stays for the checklist. */
  complete(answers: OnboardingAnswers): Promise<void>;
  /** Done without answers: a returning account already has its settings. */
  markComplete(): Promise<void>;
  dismissChecklist(): Promise<void>;
}

export function parseStoredOnboarding(raw: string | null | undefined): StoredOnboarding | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const r = parsed as Record<string, unknown>;
    const out: StoredOnboarding = { ...r, completed: r.completed === true };
    const progress = resumeProgress(r.progress);
    if (progress) out.progress = progress;
    else delete out.progress;
    if (Array.isArray(r.skippedSources)) {
      out.skippedSources = SOURCE_IDS.filter((s) => (r.skippedSources as unknown[]).includes(s));
    } else delete out.skippedSources;
    out.checklistDismissed = r.checklistDismissed === true;
    return out;
  } catch {
    return null;
  }
}

function stateOf(stored: StoredOnboarding | null): OnboardingState {
  const completed = stored?.completed ?? false;
  return { completed, inProgress: !completed && !!stored?.progress };
}

export function createOnboardingStore(
  open: () => Promise<RecordHandle>,
  changed: (state: OnboardingState) => void = () => {},
): OnboardingStore {
  // Writes are read-modify-write on one value: one at a time.
  let queue: Promise<unknown> = Promise.resolve();
  function update(fn: (current: StoredOnboarding | null) => StoredOnboarding): Promise<void> {
    const run = queue.then(async () => {
      // Opened once per write: the key is the user's at the moment it starts,
      // so a user switch cannot carry one user's record into the next's.
      const handle = await open();
      const next = fn(parseStoredOnboarding(await handle.read()));
      await handle.write(JSON.stringify(next));
      changed(stateOf(next));
    });
    queue = run.catch(() => undefined);
    return run;
  }

  async function read(): Promise<StoredOnboarding | null> {
    await queue;
    return parseStoredOnboarding(await (await open()).read());
  }

  return {
    read,
    state: async () => stateOf(await read()),
    progress: async () => {
      const stored = await read();
      return stored && !stored.completed ? (stored.progress ?? null) : null;
    },
    saveProgress: (progress) =>
      update((current) => {
        // Finished already (another screen, a restore): nothing to resume.
        if (current?.completed) return current;
        return { ...(current ?? {}), completed: false, progress };
      }),
    complete: (answers) =>
      update((current) => {
        const { progress: _progress, ...rest } = current ?? { completed: true };
        return {
          ...rest,
          completed: true,
          skippedSources: SOURCE_IDS.filter((s) => answers.skipped.includes(s)),
          checklistDismissed: false,
        };
      }),
    markComplete: () =>
      update((current) => {
        const { progress: _progress, ...rest } = current ?? { completed: true };
        return { ...rest, completed: true };
      }),
    dismissChecklist: () => update((current) => ({ ...(current ?? { completed: true }), checklistDismissed: true })),
  };
}

// ── The app's record ─────────────────────────────────────────────────────────

const listeners = new Set<(state: OnboardingState) => void>();

/** Hear every change to the record (the root layout resumes an onboarding in progress). */
export function onOnboardingChange(listener: (state: OnboardingState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const appStore = createOnboardingStore(
  async () => {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const onboardingKey = userKey(ONBOARDING_KEY);
    return {
      read: () => AsyncStorage.getItem(onboardingKey),
      write: (value: string) => AsyncStorage.setItem(onboardingKey, value),
    };
  },
  (state) => {
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch (e) {
        console.warn('[onboarding] change listener failed', e);
      }
    }
  },
);

export const getOnboardingData = (): Promise<StoredOnboarding | null> => appStore.read();
export const getOnboardingState = (): Promise<OnboardingState> => appStore.state();
export const getOnboardingProgress = (): Promise<OnboardingProgress | null> => appStore.progress();
export const saveOnboardingProgress = (progress: OnboardingProgress): Promise<void> => appStore.saveProgress(progress);
export const completeOnboarding = (answers: OnboardingAnswers): Promise<void> => appStore.complete(answers);
export const dismissGettingStarted = (): Promise<void> => appStore.dismissChecklist();

export async function isOnboardingComplete(): Promise<boolean> {
  return (await appStore.state()).completed;
}

/** Started on this device and not finished: the app reopens on it. */
export async function isOnboardingInProgress(): Promise<boolean> {
  return (await appStore.state()).inProgress;
}

/** Record onboarding as done without answers: the account already has its settings. */
export const markOnboardingComplete = (): Promise<void> => appStore.markComplete();

/** How many statement imports a stored list records (subscription-detection.ts recordImportBatch). */
export function importedBatchCount(raw: string | null | undefined): number {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((b) => !!b && typeof b === 'object').length : 0;
  } catch {
    return 0;
  }
}

/** This user has saved a statement import on this phone. */
export async function hasImportedStatement(): Promise<boolean> {
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    return importedBatchCount(await AsyncStorage.getItem(userKey(IMPORT_BATCHES_KEY))) > 0;
  } catch {
    return false;
  }
}
