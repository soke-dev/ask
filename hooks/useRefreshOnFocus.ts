import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

/**
 * Re-reads a screen's data when somebody actually looks at it.
 *
 * The board was fetched once, at startup, and then only when this device did
 * something to it. Jobs posted by anyone else did not exist as far as the app
 * was concerned until it was restarted — which is not a refresh policy, it is
 * the absence of one.
 *
 * Realtime cannot cover this gap on its own. Every change event is published
 * to `question:<id>`, so hearing about a new question requires knowing its id
 * first, and a verifier browsing the board by definition does not. Picking it
 * up on focus is the honest fix: the two moments the list can be wrong and
 * seen are when the tab is opened and when the app is brought back.
 *
 * @param refresh   What to re-run. Re-read from a ref, so callers need not
 *                  memoise it and a stale closure cannot pin old state.
 * @param minGapMs  Floor between fetches, so flicking between tabs does not
 *                  turn into a request per tap.
 */
// Promise<unknown> rather than Promise<void>, so a caller can hand over a
// Promise.all of several refreshes without casting its result away.
export function useRefreshOnFocus(
  refresh: () => void | Promise<unknown>,
  minGapMs = 4000,
): void {
  const latest = useRef(refresh);
  latest.current = refresh;

  const lastRun = useRef(0);
  /** Whether this screen is the one on show; see the AppState listener. */
  const focused = useRef(false);

  const run = useCallback(() => {
    const now = Date.now();
    if (now - lastRun.current < minGapMs) return;
    lastRun.current = now;
    void latest.current();
  }, [minGapMs]);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      run();
      return () => {
        focused.current = false;
      };
    }, [run]),
  );

  useEffect(() => {
    /**
     * Returning from the background does not re-fire useFocusEffect — the
     * screen never lost focus, the app did. Without this, reopening the app on
     * the tab you left it on showed the list as it was hours ago.
     *
     * Gated on `focused` so the tabs you are not looking at stay quiet.
     */
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && focused.current) run();
    });
    return () => sub.remove();
  }, [run]);
}
