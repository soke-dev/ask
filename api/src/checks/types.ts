/**
 * The vocabulary of the evidence gate.
 *
 * Four verdicts, and the difference between them is who gets to decide:
 *
 *   pass     nothing to say
 *   warn     the verifier is told, and may send it anyway
 *   fail     the verifier must retake — the only verdict that blocks
 *   skipped  the check did not run, and the reason is recorded
 *
 * `skipped` exists so that "we could not check this" never renders as "this
 * passed". An honest gap is useful to a reviewer; a false clean bill is not.
 */
export type Verdict = 'pass' | 'warn' | 'fail' | 'skipped';

export type CheckResult = {
  /** Stable identifier, stored and compared across versions. */
  name: string;
  /** 1 = free arithmetic on the file. 2 = costs a model call. */
  tier: 1 | 2;
  verdict: Verdict;
  /** What the verifier reads. Plain language, no jargon, no score. */
  detail: string;
  /** The measurement, kept for tuning the thresholds later. */
  score?: number;
  threshold?: number;
};

export type CheckReport = {
  /**
   * The whole gate's answer. `fail` if any check failed, else `warn` if any
   * warned, else `pass`. Derived in one place so the rule cannot drift.
   */
  verdict: Extract<Verdict, 'pass' | 'warn' | 'fail'>;
  checks: CheckResult[];
  /** Set when the report is a retake. */
  attempt?: number;
  attemptsLeft?: number;
};

export function summarise(checks: CheckResult[]): CheckReport['verdict'] {
  if (checks.some((c) => c.verdict === 'fail')) return 'fail';
  if (checks.some((c) => c.verdict === 'warn')) return 'warn';
  return 'pass';
}
