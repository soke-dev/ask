import { useEffect, useState } from 'react';

/**
 * A clock that re-renders whatever reads it.
 *
 * Anything showing time remaining computes it from a deadline at render, which
 * is correct but only updates when something else happens to re-render. A job
 * card would print "9m" and sit there — the number was right when it was drawn
 * and never drawn again.
 *
 * The interval adapts: a countdown showing whole minutes does not need a tick
 * every second, but one showing seconds does. Anything more than two minutes
 * out ticks every fifteen seconds, which is enough to keep a minutes display
 * honest at a fraction of the renders.
 */
export function useNow(deadline?: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const closeIn = deadline ? deadline - Date.now() : Infinity;
    // Stop entirely once the deadline has passed: nothing below zero changes.
    if (closeIn <= 0) return;

    const every = closeIn < 2 * 60_000 ? 1_000 : 15_000;
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [deadline, now]);

  return now;
}
