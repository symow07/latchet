import { useEffect, useState } from 'react';
import { cooldownSecondsLeft, RESEND_COOLDOWN_MS } from './auth-links';

/**
 * Seconds until "send it again" is allowed after a send at `sentAt`, ticking
 * once a second while it counts and stopping at zero. The server limits the
 * mail too (five an hour per account); this keeps an impatient double tap from
 * spending them.
 */
export function useResendCooldown(sentAt: number | null, cooldownMs: number = RESEND_COOLDOWN_MS): number {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (sentAt === null) return;
    const timer = setInterval(() => {
      const tick = Date.now();
      setNow(tick);
      if (cooldownSecondsLeft(sentAt, tick, cooldownMs) === 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [sentAt, cooldownMs]);

  // A send is never later than the clock: until the first tick, `now` can
  // predate it, and the count starts from the send instead.
  return cooldownSecondsLeft(sentAt, Math.max(now, sentAt ?? now), cooldownMs);
}
