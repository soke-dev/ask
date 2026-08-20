/**
 * How long the asker gives a verifier to deliver.
 *
 * The window is a promise in both directions: the verifier knows what they
 * signed up for, and the asker gets their money back if nobody delivers. It
 * is set at dispatch and never moves afterwards.
 */

export const DEADLINE_PRESETS = [10, 30, 60, 1440];

export const DEFAULT_DEADLINE = 30;
export const MIN_DEADLINE = 5;
/** A week. Beyond this the answer would be stale before it arrived. */
export const MAX_DEADLINE = 10_080;

/** "10 min", "1 hr 30 min", "24 hr", "2 d". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) {
    return restMinutes ? `${hours} hr ${restMinutes} min` : `${hours} hr`;
  }

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} d ${restHours} hr` : `${days} d`;
}

/** Counts down to the deadline. Seconds only matter when the end is near. */
export function formatRemaining(msLeft: number): string {
  if (msLeft <= 0) return 'Overdue';

  const total = Math.floor(msLeft / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}:${String(seconds).padStart(2, '0')} left`;
}

/** Milliseconds until the window closes. Negative once it has passed. */
export function msUntilDeadline(dispatchedAt: number | null, deadlineMinutes: number): number {
  if (!dispatchedAt) return deadlineMinutes * 60_000;
  return dispatchedAt + deadlineMinutes * 60_000 - Date.now();
}
