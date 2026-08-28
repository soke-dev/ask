/**
 * One reading of a task's server status, for every screen that needs one.
 *
 * `task_status` has six values and the app kept re-deriving meaning from three
 * of them, separately, in seven places — each with its own idea of what
 * counted. Every one of those places had the same hole: a `disputed` task
 * matched none of their branches and fell through to whatever the default
 * happened to be. So a queried question read "Waiting for someone", vanished
 * from My questions, hid the evidence being queried, asked the verifier to go
 * and photograph the place again, and appeared twice on Earn.
 *
 * The point of naming the phases is that adding a seventh status becomes one
 * edit here plus whatever the compiler then objects to, rather than a search
 * for every ternary that happened to mention 'confirmed'.
 */
export type TaskPhase =
  /** Nobody holds it. Never taken, or given back. */
  | 'open'
  /** Somebody is on their way. */
  | 'working'
  /** Evidence is in and the asker has to rule on it. */
  | 'delivered'
  /** The asker objected. A reviewer rules, not them. */
  | 'queried'
  /** Confirmed and paid. Nothing further happens. */
  | 'settled'
  /** The window closed with nothing delivered. */
  | 'expired';

export function taskPhase(status: string | null | undefined): TaskPhase {
  switch (status) {
    case 'confirmed':
      return 'settled';
    case 'disputed':
      return 'queried';
    case 'submitted':
      return 'delivered';
    case 'accepted':
      return 'working';
    case 'expired':
      return 'expired';
    /**
     * Abandoned is 'open', not an end state: a verifier who gave the job back
     * put it in exactly the condition it was in before they took it, and
     * somebody else can still do it.
     */
    case 'abandoned':
      return 'open';
    default:
      return 'open';
  }
}

/** Evidence exists for this task — it may still be disputed, but it arrived. */
export function hasEvidence(phase: TaskPhase): boolean {
  return phase === 'delivered' || phase === 'queried' || phase === 'settled';
}

/** Somebody took it, whatever happened next. */
export function isTaken(phase: TaskPhase): boolean {
  return phase !== 'open' && phase !== 'expired';
}

/** Nothing more is owed by either party. */
export function isFinished(phase: TaskPhase): boolean {
  return phase === 'settled';
}

/**
 * Still the verifier's to work on.
 *
 * Deliberately excludes 'queried': that job is finished work under review, and
 * treating it as live is what listed it on Earn as something to go and finish.
 */
export function isVerifierActive(phase: TaskPhase): boolean {
  return phase === 'working' || phase === 'delivered';
}
