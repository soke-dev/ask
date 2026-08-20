import { config } from './config.js';

/**
 * The naira rate, fetched once and shared.
 *
 * Cached process-wide rather than per user: the rate is the same for everyone,
 * the provider updates it daily, and a free endpoint should not be asked for
 * it once per screen render.
 *
 * A caveat worth carrying: this is the *official* rate. Nigeria has had a
 * persistent gap between the official rate and what people actually get, so a
 * figure quoted from here can be some way off what someone would receive
 * changing money. That is why the API returns the source and the timestamp
 * with it — the number is presented as a conversion, never as a promise.
 */
type Rate = { ngnPerUsd: number; fetchedAt: number; updatedAt: string | null };

let cached: Rate | null = null;
let inFlight: Promise<Rate | null> | null = null;

async function fetchRate(): Promise<Rate | null> {
  try {
    const response = await fetch(config.rates.url, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;

    const body = (await response.json()) as {
      result?: string;
      rates?: Record<string, number>;
      time_last_update_utc?: string;
    };

    const ngn = body.rates?.NGN;
    // A rate that is missing, zero, or absurd is worse than no rate: it would
    // silently misprice every amount on screen.
    if (typeof ngn !== 'number' || !Number.isFinite(ngn) || ngn < 100 || ngn > 100_000) {
      return null;
    }

    return { ngnPerUsd: ngn, fetchedAt: Date.now(), updatedAt: body.time_last_update_utc ?? null };
  } catch {
    return null;
  }
}

export async function ngnRate(): Promise<Rate | null> {
  if (cached && Date.now() - cached.fetchedAt < config.rates.cacheMs) return cached;

  // Collapses concurrent misses into one request, so a cold cache hit by
  // several clients at once does not become several calls to a free API.
  inFlight ??= fetchRate().finally(() => {
    inFlight = null;
  });

  const fresh = await inFlight;
  if (fresh) cached = fresh;

  // Stale beats nothing: a rate from an hour ago is still roughly right, and
  // the alternative is the amount vanishing from the screen.
  return fresh ?? cached;
}
