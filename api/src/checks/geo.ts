import { config } from '../config.js';
import type { CheckResult } from './types.js';

export type Coords = { lat: number; lng: number };

const EARTH_RADIUS_METRES = 6_371_000;

/**
 * Great-circle distance between two points, in metres.
 *
 * Haversine rather than the flat-earth approximation: the error of treating
 * degrees as a grid grows with latitude, and while it is small at Lagos'
 * 6.5°N the formula costs nothing and does not need a caveat about where the
 * app is used.
 */
export function distanceMetres(a: Coords, b: Coords): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h))));
}

/** Human-readable distance. Metres up close, one decimal of a km beyond. */
export function formatDistance(metres: number): string {
  if (metres < 1000) return `${metres}m`;
  return `${(metres / 1000).toFixed(1)}km`;
}

/**
 * Compares where the phone was against where the question pointed.
 *
 * Advisory in every case — this never returns `fail`. Consumer GPS is
 * routinely tens of metres out and much worse between tall buildings, a
 * market is far larger than the single pin representing it, and a verifier
 * standing across the road from a filling station can still see the queue
 * perfectly well. The number is reported to the asker as a fact and they
 * weigh it themselves.
 */
export function checkDistance(captured: Coords | null, target: Coords | null): CheckResult {
  if (!captured || !target) {
    return {
      name: 'distance',
      tier: 1,
      verdict: 'skipped',
      detail: !captured
        ? 'Location was not shared, so distance from the place is unknown.'
        : 'That place has no coordinates, so distance could not be measured.',
    };
  }

  const metres = distanceMetres(captured, target);
  const { nearMetres, farMetres } = config.geo;

  if (metres <= nearMetres) {
    return {
      name: 'distance',
      tier: 1,
      verdict: 'pass',
      score: metres,
      threshold: nearMetres,
      detail: `Captured ${formatDistance(metres)} from the place.`,
    };
  }

  if (metres <= farMetres) {
    return {
      name: 'distance',
      tier: 1,
      verdict: 'pass',
      score: metres,
      threshold: farMetres,
      detail: `Captured ${formatDistance(metres)} from the pin, which is normal for a large place.`,
    };
  }

  return {
    name: 'distance',
    tier: 1,
    verdict: 'warn',
    score: metres,
    threshold: farMetres,
    detail: `Captured ${formatDistance(metres)} from the place. The asker will see this.`,
  };
}
