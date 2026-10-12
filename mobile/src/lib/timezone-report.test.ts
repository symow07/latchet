import { describe, expect, test } from 'bun:test';
import { createTimezoneReporter, deviceTimeZone, type TimezoneReportDeps } from './timezone-report';

/**
 * The phone's time-zone report (Phase 5 decision 1), against a fake user, a
 * fake device zone and a fake server. cloud-sync.ts calls report() after
 * activation, when the app comes to the front and on its sync interval; these
 * tests make those calls by hand.
 */

class Unreachable extends Error {}
class Refused extends Error {}

/** A fake world: who is signed in, what zone the device is in, and how the server answers. */
function world(initial: { userId?: string | null; zone?: string | null } = {}) {
  const state = {
    userId: initial.userId === undefined ? 'user_a' : initial.userId,
    zone: initial.zone === undefined ? 'Europe/Paris' : initial.zone,
    /** How the next requests end: 'ok', 'down' (unreachable) or 'refuse' (400). */
    server: 'ok' as 'ok' | 'down' | 'refuse',
    /** Hold requests open until released. */
    hold: false,
  };
  const sent: { userId: string | null; zone: string }[] = [];
  const held: (() => void)[] = [];
  const deps: TimezoneReportDeps = {
    userId: () => state.userId,
    zone: () => state.zone,
    async send(zone) {
      sent.push({ userId: state.userId, zone });
      if (state.hold) await new Promise<void>((resolve) => held.push(resolve));
      if (state.server === 'down') throw new Unreachable('network');
      if (state.server === 'refuse') throw new Refused('400 invalid_timezone');
    },
    isRejected: (e) => e instanceof Refused,
  };
  const release = () => held.splice(0).forEach((r) => r());
  return { state, sent, deps, release, reporter: createTimezoneReporter(deps) };
}

describe('timezone report', () => {
  test('timezone report: after activation the zone is sent once, then not again while it stays the same', async () => {
    const w = world();
    expect(await w.reporter.report()).toBe('sent'); // activation
    expect(await w.reporter.report()).toBe('unchanged'); // the app comes to the front
    expect(await w.reporter.report()).toBe('unchanged'); // the sync interval
    expect(w.sent).toEqual([{ userId: 'user_a', zone: 'Europe/Paris' }]);
  });

  test('timezone report: a new zone is sent once per change, a return to an earlier one too', async () => {
    const w = world();
    await w.reporter.report();
    w.state.zone = 'Asia/Tokyo';
    expect(await w.reporter.report()).toBe('sent');
    expect(await w.reporter.report()).toBe('unchanged');
    w.state.zone = 'Europe/Paris';
    expect(await w.reporter.report()).toBe('sent');
    expect(w.sent.map((s) => s.zone)).toEqual(['Europe/Paris', 'Asia/Tokyo', 'Europe/Paris']);
  });

  test('timezone report: a failure is ignored, never thrown, and retried by the next trigger', async () => {
    const w = world();
    w.state.server = 'down';
    expect(await w.reporter.report()).toBe('failed');
    expect(await w.reporter.report()).toBe('failed');
    w.state.server = 'ok';
    expect(await w.reporter.report()).toBe('sent');
    expect(await w.reporter.report()).toBe('unchanged');
    expect(w.sent).toHaveLength(3);
  });

  test('timezone report: a zone the server refuses is not sent again until it changes', async () => {
    const w = world({ zone: 'Antarctica/Troll' });
    w.state.server = 'refuse';
    expect(await w.reporter.report()).toBe('rejected');
    expect(await w.reporter.report()).toBe('unchanged');
    w.state.server = 'ok';
    w.state.zone = 'Europe/Oslo';
    expect(await w.reporter.report()).toBe('sent');
    expect(w.sent.map((s) => s.zone)).toEqual(['Antarctica/Troll', 'Europe/Oslo']);
  });

  test('timezone report: each user is told separately — another user signing in on this phone reports again', async () => {
    const w = world();
    await w.reporter.report();
    w.state.userId = 'user_b';
    expect(await w.reporter.report()).toBe('sent');
    expect(await w.reporter.report()).toBe('unchanged');
    expect(w.sent).toEqual([
      { userId: 'user_a', zone: 'Europe/Paris' },
      { userId: 'user_b', zone: 'Europe/Paris' },
    ]);
  });

  test('timezone report: nobody signed in, or no zone from the device, sends nothing', async () => {
    for (const setup of [{ userId: null }, { zone: null }, { zone: '' }, { zone: '   ' }]) {
      const w = world(setup);
      expect(await w.reporter.report()).toBe('skipped');
      expect(w.sent).toEqual([]);
    }
    const throwing = createTimezoneReporter({
      userId: () => 'user_a',
      zone: () => {
        throw new Error('Intl is unavailable');
      },
      send: async () => {},
    });
    expect(await throwing.report()).toBe('skipped');
  });

  test('timezone report: triggers that arrive while a report is on its way join it instead of sending twice', async () => {
    const w = world();
    w.state.hold = true;
    const reports = [w.reporter.report(), w.reporter.report(), w.reporter.report()];
    w.release();
    expect(await Promise.all(reports)).toEqual(['sent', 'sent', 'sent']);
    expect(w.sent).toHaveLength(1);
  });

  test('timezone report: a change while the old zone is on its way is sent after it, so the newest arrives last', async () => {
    const w = world();
    w.state.hold = true;
    const first = w.reporter.report();
    w.state.zone = 'America/New_York';
    const second = w.reporter.report();
    // Only the first has gone; the second waits for it.
    expect(w.sent.map((s) => s.zone)).toEqual(['Europe/Paris']);
    w.release();
    await first;
    await Promise.resolve();
    w.release();
    expect(await second).toBe('sent');
    expect(w.sent.map((s) => s.zone)).toEqual(['Europe/Paris', 'America/New_York']);
    expect(await w.reporter.report()).toBe('unchanged');
  });

  test("timezone report: the device's zone is the one Intl reports", () => {
    expect(deviceTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});
