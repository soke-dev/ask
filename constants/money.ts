/**
 * Money rules, in one place so the composer, the task flow and the wallet
 * cannot drift apart on what a job costs or what a verifier keeps.
 */

/** Cut the platform takes from a bounty before the verifier is paid. */
export const PLATFORM_FEE = 0.1;

/** For copy. Derived so no screen can quote a stale percentage. */
export const FEE_PERCENT = `${Math.round(PLATFORM_FEE * 100)}%`;

/**
 * PLACEHOLDER RATE — not live FX.
 *
 * The naira moves far too much for a number baked into a bundle to stay
 * honest, so this is only here to make the dollar figure meaningful during
 * development. Before shipping, fetch a rate on app start and cache it, and
 * keep showing the rate you used the way the UI does now: a converted figure
 * with no visible rate is impossible for a user to sanity-check.
 */
/**
 * Fallback only, used when the live rate has not arrived.
 *
 * Every screen should pass the rate from `ngnPerUsd` in app context, which is
 * fetched hourly from a real provider. This exists so a conversion still
 * renders during that first moment, and so nothing crashes offline — not as
 * the number anyone should be quoting.
 */
export const NAIRA_PER_USD = 1550;

/**
 * A floor, and deliberately no ceiling.
 *
 * The floor is for the verifier: below it nobody is being paid enough to walk
 * anywhere, and an offer that low wastes the time of whoever reads it.
 *
 * There is no matching ceiling because it is the asker's own money, held in
 * their own wallet, and a cap on what somebody may choose to spend of their
 * own is not ours to set. What stops an unpayable job is the balance check on
 * the server, which asks the chain what the wallet actually holds — a limit
 * that protects a verifier from walking somewhere for a bounty that could
 * never have been funded, rather than one that second-guesses the asker.
 *
 * The agent surface is the opposite case and keeps its ceilings: money spent
 * there is ours, by anybody who opens a public page.
 */
export const MIN_BOUNTY = 150;

/** Offered as one-tap amounts; anything else goes in by hand. */
export const BOUNTY_PRESETS = [500, 1000];

export const DEFAULT_BOUNTY = 500;

/**
 * Above this, the job is restricted to identity-verified verifiers whether
 * the asker asks for it or not. Payouts settle by contract regardless — this
 * is about who is trusted with the bigger errands, not about who gets paid.
 */
export const VERIFIED_ONLY_ABOVE = 2000;

/** Thank-you for an answer you did not pay for. Voluntary, so no floor worth
 *  enforcing beyond keeping the transfer above dust. */
export const TIP_PRESETS = [50, 100, 200];
export const MIN_TIP = 20;
export const MAX_TIP = 20_000;

/** What a bounty is worth in dollars, to two decimal places. */
export function toUsd(naira: number, ngnPerUsd: number = NAIRA_PER_USD): string {
  return (naira / ngnPerUsd).toFixed(2);
}

/** Thousands-separated naira, without the symbol. */
export function formatNaira(naira: number): string {
  return naira.toLocaleString('en-NG');
}

/** What the verifier actually receives after the platform fee. */
export function verifierCut(bounty: number): number {
  return Math.round(bounty * (1 - PLATFORM_FEE));
}

/**
 * Rough guidance on pickup speed. Higher bounties get taken faster, and
 * saying so up front is fairer than letting a lowball offer sit unanswered.
 */
export function pickupHint(bounty: number): string {
  if (bounty >= 1000) return 'Usually picked up within a minute';
  if (bounty >= 500) return 'Usually picked up in a few minutes';
  if (bounty >= 300) return 'Typical for a quick errand nearby';
  return 'May sit a while at this price';
}
