import { useEffect, useState } from 'react';

/**
 * The time now, moving on every `everyMs` while the screen is mounted. For
 * labels such as "5 min ago" that must keep counting between fetches: reading
 * the clock during render is impure (the React Compiler's checks refuse it),
 * and the time of the last fetch freezes the label until the next one.
 */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);

  return now;
}
