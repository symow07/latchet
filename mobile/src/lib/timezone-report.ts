/**
 * Tells the server which time zone this phone is in (Phase 5 decision 1).
 *
 * The server books recurring transactions and fires bill reminders by the
 * user's own calendar day — the date in the zone their phone last reported
 * (PUT /api/v1/me/timezone), UTC's until one has. The zone is a fact about
 * the device, not a synced setting: it changes when the phone crosses one,
 * and nothing about it is the user's to edit.
 *
 * So the phone reports it after the user's database is activated (signing
 * in, or launching signed in) and again whenever it has changed — checked
 * when the app comes to the front and on the sync interval while it is
 * there (lib/cloud-sync.ts wires those). Once per change: a zone the server
 * has taken for this user is not sent again until it differs. A report that
 * fails is ignored — nothing waits for it, nothing is shown — and the next
 * trigger tries again. A zone the server refuses as unknown is not retried
 * until it changes, since sending it again would only be refused again.
 *
 * What was last reported lives in memory: a cold launch reports once more,
 * which costs one small request and repairs a server that was told another
 * zone by another of the user's devices in the meantime.
 *
 * No React, no network of its own: cloud-sync.ts hands it the active user,
 * the device's zone and the request, so `bun test` holds it.
 */

/** What one call to report() did. */
export type TimezoneReportOutcome =
  /** The server took this zone for this user. */
  | 'sent'
  /** The server already has it from this phone: nothing sent. */
  | 'unchanged'
  /** Nobody is signed in, or the device gave no zone: nothing to send. */
  | 'skipped'
  /** The request failed; the next trigger tries again. */
  | 'failed'
  /** The server refused the zone itself; not sent again until it changes. */
  | 'rejected';

export interface TimezoneReportDeps {
  /** The signed-in user whose database is active, or null. */
  userId(): string | null;
  /** The device's IANA time zone now (deviceTimeZone), or null. */
  zone(): string | null | undefined;
  /** PUT it to the server for the signed-in user. Rejects on any failure. */
  send(timeZone: string): Promise<unknown>;
  /** A failure that means the server refused this zone, not that it could not be reached. */
  isRejected?(error: unknown): boolean;
}

export interface TimezoneReporter {
  /** Report the zone if it changed since the server last took it. Never rejects. */
  report(): Promise<TimezoneReportOutcome>;
}

/** The device's IANA time zone, as Intl reports it; null when it cannot say. */
export function deviceTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && zone.length > 0 ? zone : null;
  } catch {
    return null;
  }
}

export function createTimezoneReporter(deps: TimezoneReportDeps): TimezoneReporter {
  /** User and zone the server last took (or refused for good). */
  let settled: string | null = null;
  /** The report on its way, and what it carries. */
  let inFlight: { key: string; done: Promise<TimezoneReportOutcome> } | null = null;

  const keyOf = (userId: string, zone: string) => `${userId}\u0000${zone}`;

  /** The user and zone to report now, or null when there is nothing to send. */
  function current(): { userId: string; zone: string } | null {
    try {
      const userId = deps.userId();
      const zone = deps.zone();
      if (!userId || typeof zone !== 'string' || zone.trim().length === 0) return null;
      return { userId, zone: zone.trim() };
    } catch {
      return null;
    }
  }

  async function send(key: string, zone: string): Promise<TimezoneReportOutcome> {
    try {
      await deps.send(zone);
      settled = key;
      return 'sent';
    } catch (e) {
      let rejected = false;
      try {
        rejected = deps.isRejected?.(e) === true;
      } catch {
        // Treat it as a failure to reach the server: retried later.
      }
      if (rejected) {
        settled = key;
        return 'rejected';
      }
      return 'failed';
    }
  }

  function report(): Promise<TimezoneReportOutcome> {
    const now = current();
    if (!now) return Promise.resolve('skipped');
    const key = keyOf(now.userId, now.zone);
    if (key === settled) return Promise.resolve('unchanged');

    if (inFlight) {
      // The same report is on its way: join it.
      if (inFlight.key === key) return inFlight.done;
      // Another (an older zone, or the previous user's): one at a time, so the
      // server ends up with the newest; then look again.
      return inFlight.done.then(() => report());
    }

    const done = send(key, now.zone).finally(() => {
      if (inFlight?.done === done) inFlight = null;
    });
    inFlight = { key, done };
    return done;
  }

  return { report };
}
