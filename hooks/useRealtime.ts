import { useEffect, useRef, useState } from 'react';
import {
  getStatus,
  subscribe,
  watchStatus,
  type ChangeEvent,
  type RealtimeStatus,
} from '@/utils/realtime';

/**
 * Listens to a topic for as long as the screen is mounted.
 *
 * Pass `null` to listen to nothing — handy when the id is not known yet, and
 * better than calling the hook conditionally.
 */
export function useRealtime(topic: string | null, onChange: (event: ChangeEvent) => void): void {
  // Kept in a ref so a caller passing an inline arrow does not tear the
  // subscription down and build it up again on every single render.
  const handler = useRef(onChange);
  handler.current = onChange;

  useEffect(() => {
    if (!topic) return;
    return subscribe(topic, (event) => handler.current(event));
  }, [topic]);
}

/** For showing a live/offline dot. `disabled` means no backend in this build. */
export function useRealtimeStatus(): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>(getStatus);
  useEffect(() => watchStatus(setStatus), []);
  return status;
}
