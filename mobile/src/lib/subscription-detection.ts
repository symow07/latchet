/**
 * The phone's subscription detection: one run over every source.
 *
 * The detection itself is lib/subscriptions/engine (reconcileSubscriptions),
 * pure and shared. This is the runner around it:
 *
 *   gather    every ledger charge — bank (Plaid rows arrive by sync with
 *             provider-namespaced ids), statement import (the batches
 *             import.tsx records) or typed by hand — the email findings the
 *             phone has pulled, and the stored subscriptions;
 *   reconcile with today's local date;
 *   write     merges (history moved, then the folded row deleted), upserts
 *             through db.ts's upsertSubscription, which never touches the
 *             user's decision, and the occurrences (deterministic ids, so
 *             re-writing is a no-op);
 *   remind    the events and the rows as they now stand go to the reminder
 *             planner (subscription-reminders.ts, scheduled by notifications.ts);
 *   refresh   every screen showing subscriptions (onDetectionChange).
 *
 * Runs are serialised: a trigger while one runs schedules exactly one more,
 * which every trigger in the meantime joins. Nothing a run does can reject
 * into the caller that triggered it — an import, a sync, a notification.
 *
 * It runs by itself (C15): after an import is saved, after an email sync,
 * after a sync pull that brought transactions (that is how Plaid's arrive),
 * once each time a user's database activates, and on a Scan tap.
 *
 * Nothing native is imported at the top: the database, storage, rates and
 * notifications are reached lazily through the default dependencies, so
 * createDetectionRunner runs under `bun test` with stand-ins.
 */
import { todayISO, daysAheadISO, isBetween } from './dates';
import type {
  LocalEmailFinding,
  Subscription,
  SubscriptionDecision,
  SubscriptionOccurrence,
  SubscriptionUpsert,
} from './db';
import type { Transaction } from './transaction';
import { occurrenceId, reconcileSubscriptions } from './subscriptions/engine';
import { daysBetween, isISODate, monthlyFactor } from './subscriptions/cadence';
import { chargesFromTransactions } from './subscriptions/sources';
import type {
  ChargeSource,
  DetectionEvent,
  EmailEvidence,
  SubscriptionRecord,
} from './subscriptions/types';

export {
  normalizeMerchant,
  displayMerchant,
  detectSubscriptions,
  monthlyCost,
} from './subscriptions/engine';
export { chargesFromTransactions } from './subscriptions/sources';
export type {
  DetectedSubscription,
  DetectionEvent,
  SourceCharge,
  Cadence,
} from './subscriptions/types';

// ── The contract (I-RUNNER) ──────────────────────────────────────────────────

export type DetectionReason = 'import' | 'email' | 'bank' | 'sync' | 'manual' | 'onboarding' | 'startup';

export interface DetectionSummary {
  /** Subscriptions and trials this run found that did not exist before it. */
  newSubscriptions: Subscription[];
  /** Everything running and charging: active, kept, and free trials about to convert. */
  active: Subscription[];
  /** What `active` costs per month, in `currency`. */
  monthlyTotal: number;
  /** The user's currency. */
  currency: string;
  events: DetectionEvent[];
  /**
   * How many of `active` are left out of monthlyTotal because their currency
   * could not be converted (no rate cached): never added in at face value.
   */
  notInTotal: number;
}

/** The query key every subscription list reads; a run invalidates it. */
export const SUBSCRIPTIONS_QUERY_KEY = ['subscriptions'] as const;

export interface RunOptions {
  /**
   * The user is here and acting (an import, a Scan, onboarding, connecting an
   * inbox, a decision): the moment it is fair to ask for notification
   * permission, if there is something to remind them of. Background runs
   * (startup, sync, bank, a routine email sync) never ask.
   */
  interactive?: boolean;
  /**
   * Announce what this run finds with a notification. By default yes, except
   * when the user is looking at the finds on screen (a Scan, onboarding's
   * payoff, the inbox they just connected); finds kept quiet are still
   * recorded as told, so they are never announced later either.
   */
  announce?: boolean;
}

/** Runs the user triggered and is waiting on. */
const INTERACTIVE_REASONS: ReadonlySet<DetectionReason> = new Set(['import', 'manual', 'onboarding']);
/** Runs whose finds are on the screen in front of the user: no "found" notification for them. */
const WATCHED_REASONS: ReadonlySet<DetectionReason> = new Set(['manual', 'onboarding']);
/** Statuses that are running and will charge. */
const RUNNING: ReadonlySet<string> = new Set(['active', 'confirmed', 'trial']);
/** Statuses that are over, one way or another. */
const OVER: ReadonlySet<string> = new Set(['canceled', 'dismissed', 'ended']);

// ── Where a ledger charge came from ──────────────────────────────────────────

/**
 * Bank transactions are written by the server and reach the phone by sync,
 * with ids namespaced by provider (backend lib/bank-sync.ts transactionId:
 * `plaid_<id>`). A hand-typed or imported row has a phone-made id.
 */
export const BANK_TRANSACTION_PREFIXES: readonly string[] = ['plaid_'];

export function isBankTransactionId(id: string): boolean {
  return BANK_TRANSACTION_PREFIXES.some((p) => id.startsWith(p));
}

/** One statement import: the span of time its rows were written in (ISO instants). */
export interface ImportBatch {
  from: string;
  to: string;
}

/**
 * Where each transaction came from: the bank for a provider's row, an import
 * for one written during a recorded import, by hand otherwise.
 *
 * A transaction row records no origin of its own, and an imported row gets a
 * phone-made id like any other; what tells it apart is that it was written
 * inside an import (import.tsx records each batch's span, per user). Rows
 * imported since ids carried their origin start `imp_` and read as imported
 * on every device; older rows imported on another device read as typed by
 * hand here, which costs only precision: the engine folds a hand entry and a
 * statement line for the same payment only when they agree exactly.
 */
/** Ids of rows saved by a statement import (db.ts addTransaction, origin 'import'). */
export const IMPORTED_TRANSACTION_PREFIX = 'imp_';

export function transactionSourceOf(batches: readonly ImportBatch[]): (tx: { id: string; createdAt?: string | null }) => ChargeSource {
  const spans = batches
    .map((b) => [Date.parse(b.from), Date.parse(b.to)] as const)
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && a <= b);
  return (tx) => {
    if (isBankTransactionId(tx.id)) return 'bank';
    if (tx.id.startsWith(IMPORTED_TRANSACTION_PREFIX)) return 'import';
    const at = Date.parse(tx.createdAt ?? '');
    if (Number.isFinite(at) && spans.some(([a, b]) => at >= a && at <= b)) return 'import';
    return 'manual';
  };
}

/** A cached email finding as the engine's evidence; null when it has no usable date. */
export function emailEvidenceFrom(f: LocalEmailFinding): EmailEvidence | null {
  const sent = typeof f.emailDateISO === 'string' ? f.emailDateISO.slice(0, 10) : '';
  const received = typeof f.receivedAt === 'string' ? f.receivedAt.slice(0, 10) : '';
  const dateISO = isISODate(sent) ? sent : isISODate(received) ? received : null;
  if (!dateISO || !f.id) return null;
  const day = (v: string | null) => (typeof v === 'string' && isISODate(v.slice(0, 10)) ? v.slice(0, 10) : null);
  return {
    id: f.id,
    kind: f.kind,
    merchant: f.merchant,
    senderDomain: f.senderDomain,
    billedVia: f.billedVia,
    amount: f.amount,
    currency: f.currency,
    cadence: f.cadence,
    dateISO,
    chargedISO: day(f.chargedISO),
    nextChargeISO: day(f.nextChargeISO),
    trialEndsISO: day(f.trialEndsISO),
    previousAmount: f.previousAmount,
    source: f.source,
  };
}

/** A stored row in the engine's exact shape (plus createdAt, which it reads to pick a merge target). */
export function toEngineRecord(s: Subscription): SubscriptionRecord & { createdAt: string } {
  return {
    id: s.id,
    merchantDisplay: s.merchantDisplay,
    merchantNormalized: s.merchantNormalized,
    cadence: s.cadence,
    typicalAmount: s.typicalAmount,
    currency: s.currency,
    confidenceScore: s.confidenceScore,
    lastChargedAt: s.lastChargedAt,
    nextExpectedAt: s.nextExpectedAt,
    status: s.status,
    cancelUrl: s.cancelUrl,
    cancelNotes: s.cancelNotes,
    source: s.source,
    sources: s.sources ?? '',
    decision: s.decision ?? null,
    canceledAt: s.canceledAt ?? null,
    trialEndsAt: s.trialEndsAt ?? null,
    previousAmount: s.previousAmount ?? null,
    priceChangedAt: s.priceChangedAt ?? null,
    alert: s.alert ?? null,
    billedVia: s.billedVia ?? null,
    createdAt: s.createdAt,
  };
}

/**
 * A held occurrence that is this same payment under another source's id: the
 * engine folds the copies of one payment seen within a few days by different
 * sources, and the copy that represents it can change — a statement line
 * first, the bank's row once the bank is linked. Its history keeps one entry.
 */
export function heldSamePayment(
  held: readonly { chargedAt: string; amount: number }[],
  occ: { dateISO: string; amount: number },
): boolean {
  return held.some(
    (h) =>
      isISODate(h.chargedAt) &&
      Math.abs(daysBetween(h.chargedAt, occ.dateISO)) <= 4 &&
      Math.abs(h.amount - occ.amount) <= Math.max(0.5, 0.1 * Math.max(Math.abs(h.amount), Math.abs(occ.amount))),
  );
}

// ── Money ────────────────────────────────────────────────────────────────────

/**
 * An amount in another currency through USD-based rates; null when either
 * rate is missing. Never the amount unchanged: euros are not dollars.
 */
export function convertAmount(
  amount: number,
  from: string,
  to: string,
  rates: Readonly<Record<string, number>> | null,
): number | null {
  const a = (from || '').toUpperCase();
  const b = (to || '').toUpperCase();
  if (a === b) return amount;
  const ra = rates?.[a];
  const rb = rates?.[b];
  if (typeof ra !== 'number' || !(ra > 0) || typeof rb !== 'number' || !(rb > 0)) return null;
  return (amount / ra) * rb;
}

/** What a set of subscriptions costs per month in one currency, and how many could not be converted. */
export function monthlyTotalIn(
  subs: readonly { cadence: string; typicalAmount: number; currency: string }[],
  currency: string,
  rates: Readonly<Record<string, number>> | null,
): { total: number; notInTotal: number } {
  let total = 0;
  let notInTotal = 0;
  for (const s of subs) {
    const monthly = (Number(s.typicalAmount) || 0) * monthlyFactor(s.cadence);
    if (monthly === 0) continue;
    const converted = convertAmount(monthly, s.currency || currency, currency, rates);
    if (converted === null) notInTotal++;
    else total += converted;
  }
  return { total: Math.round(total * 100) / 100, notInTotal };
}

// ── After a sync pull: does it call for a run? ───────────────────────────────

/** What one cycle's pull pages carried, as far as detection cares. */
export interface PullTally {
  /** Transaction rows changed or deleted. */
  transactions: number;
  /** Of those, the bank's (Plaid's). */
  bankTransactions: number;
  /** Subscription rows changed or deleted (a decision made on another device). */
  subscriptions: number;
}

export function emptyPullTally(): PullTally {
  return { transactions: 0, bankTransactions: 0, subscriptions: 0 };
}

/** Add one pull page's rows to the tally. */
export function tallyPullPage(
  tally: PullTally,
  page: {
    changes?: Partial<Record<string, readonly { id: string }[] | undefined>> | null;
    deletions?: readonly { entity: string; id: string }[] | null;
  } | null,
): PullTally {
  if (!page) return tally;
  const txs = page.changes?.transactions ?? [];
  const deletions = page.deletions ?? [];
  const txDeletions = deletions.filter((d) => d.entity === 'transactions');
  tally.transactions += txs.length + txDeletions.length;
  tally.bankTransactions += [...txs, ...txDeletions].filter((r) => typeof r?.id === 'string' && isBankTransactionId(r.id)).length;
  tally.subscriptions +=
    (page.changes?.subscriptions?.length ?? 0) + deletions.filter((d) => d.entity === 'subscriptions').length;
  return tally;
}

/**
 * What a finished sync cycle calls for: a detection run when its pull changed
 * the ledger's transactions ('bank' when the bank's were among them), or
 * when a run is waiting for this database's first pull to complete; else just
 * a re-plan of the reminders when only subscriptions changed (a decision made
 * on another device must silence this one's reminders too).
 */
export function detectionAfterPull(
  report: { pulled: { changed: number; complete: boolean } },
  tally: PullTally,
  deferred: boolean,
): { detect: 'bank' | 'sync' | null; replan: boolean } {
  const changed = report.pulled.changed > 0;
  if (changed && tally.transactions > 0) return { detect: tally.bankTransactions > 0 ? 'bank' : 'sync', replan: false };
  if (deferred && report.pulled.complete) return { detect: 'sync', replan: false };
  return { detect: null, replan: changed && tally.subscriptions > 0 };
}

// ── The runner ───────────────────────────────────────────────────────────────

/** What the reminder planner is handed after a run, or a decision. */
export interface ReminderRequest {
  subscriptions: Subscription[];
  events: DetectionEvent[];
  /** The user the reminders are for: their notifications carry it. */
  uid: string;
  /** Announce finds now (false when the user is looking at them). */
  announceFinds: boolean;
  /** Fair to ask for notification permission, if anything is worth it. */
  interactive: boolean;
}

/** Everything a run touches. The app's are below; tests pass stand-ins. */
export interface DetectionDeps {
  /** The user whose database is active, or null. */
  activeUser(): Promise<string | null>;
  /** This database has not completed its first pull (an upgraded file, a reinstall). */
  needsFirstPull(): Promise<boolean>;
  getTransactions(): Promise<Transaction[]>;
  getEmailFindings(): Promise<LocalEmailFinding[]>;
  getSubscriptions(): Promise<Subscription[]>;
  upsertSubscription(sub: SubscriptionUpsert): Promise<boolean>;
  moveSubscriptionOccurrences(fromId: string, toId: string): Promise<number>;
  deleteSubscription(id: string): Promise<void>;
  getSubscriptionOccurrences(subscriptionId: string): Promise<SubscriptionOccurrence[]>;
  addSubscriptionOccurrence(occ: SubscriptionOccurrence): Promise<void>;
  setSubscriptionDecision(id: string, decision: SubscriptionDecision | null): Promise<boolean>;
  importBatches(): Promise<ImportBatch[]>;
  userCurrency(): Promise<string>;
  /** USD-based rates, or null when there are none. */
  rates(): Promise<Record<string, number> | null>;
  scheduleReminders(request: ReminderRequest): Promise<void>;
  /** YYYY-MM-DD, the user's local date. */
  today(): string;
  /** Subscriptions changed: refresh what screens show. */
  changed(): void;
}

/** A user switch overtook a run: whatever it computed belongs to someone else. */
class UserChangedError extends Error {
  constructor() {
    super('The active user changed during subscription detection');
    this.name = 'UserChangedError';
  }
}

export interface DetectionRunner {
  runDetection(reason: DetectionReason, options?: RunOptions): Promise<DetectionSummary>;
  decideSubscription(id: string, decision: SubscriptionDecision | null): Promise<boolean>;
  replanReminders(options?: RunOptions): Promise<void>;
  /** A run is waiting for this database's first complete pull. */
  isDeferred(): boolean;
}

function emptySummary(currency = ''): DetectionSummary {
  return { newSubscriptions: [], active: [], monthlyTotal: 0, currency, events: [], notInTotal: 0 };
}

export function createDetectionRunner(deps: DetectionDeps): DetectionRunner {
  /** What a run was asked for, merged over every trigger that joined it. */
  interface RunRequest {
    interactive: boolean;
    announce: boolean;
  }
  let active: Promise<DetectionSummary> | null = null;
  let pending: (RunRequest & { promise: Promise<DetectionSummary> }) | null = null;
  let deferred = false;

  async function writeResult(uid: string, stored: Subscription[], findings: LocalEmailFinding[], today: string, charges: ReturnType<typeof chargesFromTransactions>) {
    const email = findings.map(emailEvidenceFrom).filter((e): e is EmailEvidence => e !== null);
    const result = reconcileSubscriptions({ charges, email, existing: stored.map(toEngineRecord), today });

    const mine = async () => {
      if ((await deps.activeUser()) !== uid) throw new UserChangedError();
    };
    for (const m of result.merges) {
      await mine();
      await deps.moveSubscriptionOccurrences(m.fromId, m.intoId);
      await deps.deleteSubscription(m.fromId);
    }
    for (const u of result.upserts) {
      await mine();
      await deps.upsertSubscription(u);
    }

    // Occurrences: every one the engine returns, written once. Read what each
    // subscription holds first, so a quiet run writes nothing.
    const emailIds = new Set(findings.map((f) => f.id));
    const bySub = new Map<string, typeof result.occurrences>();
    for (const o of result.occurrences) {
      const list = bySub.get(o.subscriptionId) ?? [];
      list.push(o);
      bySub.set(o.subscriptionId, list);
    }
    let occurrencesWritten = 0;
    for (const [subscriptionId, occs] of bySub) {
      await mine();
      const held = await deps.getSubscriptionOccurrences(subscriptionId);
      const heldIds = new Set(held.map((h) => h.id));
      const heldCharges = new Set(held.map((h) => h.transactionId).filter((t): t is string => !!t));
      const fresh = occs.filter((o) => {
        // A charge moved here from a merged row keeps its old id: same charge, not a new one.
        if (heldIds.has(occurrenceId(subscriptionId, o.chargeId)) || heldCharges.has(o.chargeId)) return false;
        return !heldSamePayment(held, o);
      });
      for (const o of fresh) {
        await deps.addSubscriptionOccurrence({
          id: occurrenceId(subscriptionId, o.chargeId),
          subscriptionId,
          // A payment only an email saw has no ledger transaction behind it.
          transactionId: emailIds.has(o.chargeId) ? null : o.chargeId,
          chargedAt: o.dateISO,
          amount: o.amount,
        });
        occurrencesWritten++;
      }
    }
    return { result, wrote: result.upserts.length + result.merges.length + occurrencesWritten > 0 };
  }

  async function execute({ interactive, announce }: RunRequest): Promise<DetectionSummary> {
    let uid: string | null = null;
    try {
      uid = await deps.activeUser();
      if (!uid) return emptySummary();
      // An upgraded or reinstalled database has not pulled the user's
      // decisions yet: writing a derived state now could push it over them.
      // The run waits for the first complete pull (cloud-sync asks again).
      if (await deps.needsFirstPull()) {
        deferred = true;
        return emptySummary();
      }
      deferred = false;

      const [transactions, findings, stored, batches, userCurrency] = await Promise.all([
        deps.getTransactions(),
        deps.getEmailFindings(),
        deps.getSubscriptions(),
        deps.importBatches().catch(() => [] as ImportBatch[]),
        deps.userCurrency().catch(() => ''),
      ]);
      const currency = userCurrency || 'USD';
      const charges = chargesFromTransactions(transactions, transactionSourceOf(batches), currency);
      const today = deps.today();
      const { result, wrote } = await writeResult(uid, stored, findings, today, charges);

      const after = await deps.getSubscriptions();
      if ((await deps.activeUser()) !== uid) throw new UserChangedError();
      await deps
        .scheduleReminders({
          subscriptions: after,
          events: result.events,
          uid,
          announceFinds: announce,
          interactive,
        })
        .catch((e) => console.warn('[detection] reminders not planned', e));
      if (wrote) deps.changed();

      const existing = new Set(stored.map((s) => s.id));
      const found = new Set(
        result.events
          .filter((e) => (e.type === 'new' || e.type === 'trial_found') && !existing.has(e.subscriptionId))
          .map((e) => e.subscriptionId),
      );
      const running = after.filter((s) => RUNNING.has(s.status));
      const rates = await deps.rates().catch(() => null);
      const { total, notInTotal } = monthlyTotalIn(running, currency, rates);
      return {
        newSubscriptions: after.filter((s) => found.has(s.id)),
        active: running,
        monthlyTotal: total,
        currency,
        events: result.events,
        notInTotal,
      };
    } catch (e) {
      if (e instanceof UserChangedError) return emptySummary();
      console.warn('[detection] run failed', e);
      // Part of it may have been written before it failed: show what is there.
      deps.changed();
      return emptySummary();
    }
  }

  function launch(request: RunRequest): Promise<DetectionSummary> {
    const run = execute(request).finally(() => {
      if (active === run) active = null;
    });
    active = run;
    return run;
  }

  function runDetection(reason: DetectionReason, options: RunOptions = {}): Promise<DetectionSummary> {
    const interactive = options.interactive ?? INTERACTIVE_REASONS.has(reason);
    const announce = options.announce ?? !WATCHED_REASONS.has(reason);
    // Joining the queued run comes first: between one run ending and the
    // queued one starting there is a moment with no active run, and a trigger
    // in it must join the queue, not start a second run beside it.
    if (pending) {
      pending.interactive ||= interactive;
      pending.announce ||= announce;
      return pending.promise;
    }
    if (!active) return launch({ interactive, announce });
    const queued: RunRequest & { promise: Promise<DetectionSummary> } = {
      promise: Promise.resolve(emptySummary()),
      interactive,
      announce,
    };
    queued.promise = active
      .catch(() => emptySummary())
      .then(() => {
        if (pending === queued) pending = null;
        return launch(queued);
      });
    pending = queued;
    return queued.promise;
  }

  async function replanReminders(options: RunOptions = {}): Promise<void> {
    try {
      const uid = await deps.activeUser();
      if (!uid) return;
      const subscriptions = await deps.getSubscriptions();
      if ((await deps.activeUser()) !== uid) return;
      await deps.scheduleReminders({
        subscriptions,
        events: [],
        uid,
        announceFinds: false,
        interactive: options.interactive ?? false,
      });
    } catch (e) {
      console.warn('[detection] reminders not re-planned', e);
    }
  }

  async function decideSubscription(id: string, decision: SubscriptionDecision | null): Promise<boolean> {
    const changed = await deps.setSubscriptionDecision(id, decision);
    deps.changed();
    // A run in progress read the rows before this decision; its plan must not
    // be the last word, so re-plan after it.
    if (active) await active.catch(() => undefined);
    await replanReminders({ interactive: true });
    return changed;
  }

  return { runDetection, decideSubscription, replanReminders, isDeferred: () => deferred };
}

// ── The app's runner ─────────────────────────────────────────────────────────

/** Per user (storage-keys.ts): the spans of time this user's statement imports wrote in. */
const IMPORT_BATCHES_KEY = 'imported_batches_v1';
/** Enough for years of monthly imports; the oldest go first. */
const MAX_IMPORT_BATCHES = 300;
/** How long a run waits for fresh rates before using the cached or bundled table. */
const RATES_WAIT_MS = 4_000;

const listeners = new Set<() => void>();

/** Hear about every change a run or a decision makes to the subscriptions. Returns the unsubscribe. */
export function onDetectionChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyChanged(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (e) {
      console.warn('[detection] change listener failed', e);
    }
  }
}

function parseBatches(raw: string | null): ImportBatch[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (b): b is ImportBatch => !!b && typeof b.from === 'string' && typeof b.to === 'string',
    );
  } catch {
    return [];
  }
}

async function readImportBatches(): Promise<ImportBatch[]> {
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  const { userKey } = await import('./storage-keys');
  return parseBatches(await AsyncStorage.getItem(userKey(IMPORT_BATCHES_KEY)));
}

/**
 * Remember that a statement import wrote its rows between `from` and `to`
 * (ISO instants), so the runner knows them for statement lines. import.tsx
 * calls it once the rows are saved. Never throws: losing this costs only the
 * engine's precision, never the import.
 */
export async function recordImportBatch(from: string, to: string): Promise<void> {
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const { userKey } = await import('./storage-keys');
    const key = userKey(IMPORT_BATCHES_KEY);
    const batches = parseBatches(await AsyncStorage.getItem(key));
    batches.push({ from, to });
    await AsyncStorage.setItem(key, JSON.stringify(batches.slice(-MAX_IMPORT_BATCHES)));
  } catch (e) {
    console.warn('[detection] import batch not recorded', e);
  }
}

async function cachedRates(): Promise<Record<string, number> | null> {
  const { bundledSnapshot, loadRates } = await import('./rates');
  const bundled = bundledSnapshot().rates;
  const live = await Promise.race([
    loadRates().then((s) => s.rates).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), RATES_WAIT_MS)),
  ]);
  return { ...bundled, ...(live ?? {}) };
}

const appDeps: DetectionDeps = {
  activeUser: async () => (await import('./db')).activeUserId(),
  needsFirstPull: async () => (await import('./cloud-sync')).needsFirstPull(),
  getTransactions: async () => (await import('./db')).getTransactions(),
  getEmailFindings: async () => (await import('./db')).getEmailFindings(),
  getSubscriptions: async () => (await import('./db')).getSubscriptions(),
  upsertSubscription: async (sub) => (await import('./db')).upsertSubscription(sub),
  moveSubscriptionOccurrences: async (from, to) => (await import('./db')).moveSubscriptionOccurrences(from, to),
  deleteSubscription: async (id) => (await import('./db')).deleteSubscription(id),
  getSubscriptionOccurrences: async (id) => (await import('./db')).getSubscriptionOccurrences(id),
  addSubscriptionOccurrence: async (occ) => (await import('./db')).addSubscriptionOccurrence(occ),
  setSubscriptionDecision: async (id, decision) => (await import('./db')).setSubscriptionDecision(id, decision),
  importBatches: readImportBatches,
  userCurrency: async () => (await (await import('./db')).getSettings()).currency,
  rates: cachedRates,
  scheduleReminders: async (request) => (await import('./notifications')).scheduleSubscriptionReminders(request),
  today: () => todayISO(),
  changed: notifyChanged,
};

const appRunner = createDetectionRunner(appDeps);

/**
 * Run detection over everything the phone has. Serialised and coalescing;
 * never rejects (a failed run resolves with an empty summary).
 */
export function runDetection(reason: DetectionReason, options?: RunOptions): Promise<DetectionSummary> {
  return appRunner.runDetection(reason, options);
}

/** The user's decision about a subscription (keep, cancel, dismiss; null to undo), then a fresh reminder plan. */
export function decideSubscription(id: string, decision: SubscriptionDecision | null): Promise<boolean> {
  return appRunner.decideSubscription(id, decision);
}

/** Re-plan the reminders from the subscriptions as they stand (a language change, a decision synced in). */
export function replanReminders(options?: RunOptions): Promise<void> {
  return appRunner.replanReminders(options);
}

/** A run is waiting for this database's first complete pull (cloud-sync runs it then). */
export function isDetectionDeferred(): boolean {
  return appRunner.isDeferred();
}

/** @deprecated The Scan button's name for runDetection('manual'), until leaf 6.7 moves it. */
export function scanAndSaveSubscriptions(): Promise<DetectionSummary> {
  return runDetection('manual');
}

// ── Helpers the screens use ──────────────────────────────────────────────────

/** Subscriptions due within the next `withinDays` days. */
export function getUpcomingCharges(
  subscriptions: Subscription[],
  withinDays: number = 30
): Subscription[] {
  // Compare as YYYY-MM-DD strings. Parsing nextExpectedAt with `new Date()`
  // gives UTC midnight while `new Date()` for today carries the local wall
  // clock, so east of UTC a charge due *today* tested as already past and
  // vanished from the list part-way through the morning.
  const today = todayISO();
  const cutoff = daysAheadISO(withinDays);
  return subscriptions
    .filter((s) => !OVER.has(s.status) && s.nextExpectedAt)
    .filter((s) => isBetween(s.nextExpectedAt!.slice(0, 10), today, cutoff))
    .sort((a, b) => (a.nextExpectedAt ?? '').localeCompare(b.nextExpectedAt ?? ''));
}

/**
 * Total monthly cost of the subscriptions still running (not cancelled,
 * dismissed or ended). With a currency and rates, in that currency, leaving
 * out what cannot be converted; without, the plain sum the older screens show.
 */
export function monthlySubscriptionTotal(
  subscriptions: Subscription[],
  convertTo?: { currency: string; rates: Readonly<Record<string, number>> | null },
): number {
  const live = subscriptions.filter((s) => !OVER.has(s.status));
  if (convertTo) return monthlyTotalIn(live, convertTo.currency, convertTo.rates).total;
  return live.reduce((sum, s) => sum + (Number(s.typicalAmount) || 0) * monthlyFactor(s.cadence), 0);
}
