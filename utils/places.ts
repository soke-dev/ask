import type { Place } from '@/contexts/AppContext';

/**
 * Place search, backed by Google Places when a key is configured and by a
 * built-in list when it is not.
 *
 * Set EXPO_PUBLIC_GOOGLE_PLACES_KEY to go live. Be aware of what the prefix
 * means: EXPO_PUBLIC_* values are inlined into the JavaScript bundle at build
 * time, so the key ships to every client and is readable by anyone who looks.
 * That is workable — it is how browser-side Maps keys normally operate — but
 * only if the key is locked down in the Google Cloud console:
 *
 *   · Web        restrict by HTTP referrer to your own domains
 *   · iOS        restrict by bundle identifier
 *   · Android    restrict by package name + SHA-1
 *   · All        restrict the key to the Places API alone, and set a quota cap
 *
 * If you would rather the key never left your infrastructure, proxy these two
 * calls through a backend and point the fetches at it instead. Nothing else in
 * the app needs to change.
 */

const KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_KEY;

export type PlacesProvider = 'google' | 'photon' | 'local';

/**
 * `photon` needs no key, no account and no billing — it is OpenStreetMap data
 * served by Komoot's public Photon instance, which unlike Nominatim is built
 * for type-ahead querying. The trade is coverage: OSM knows Lagos roads and
 * landmarks well but is thin on small shops and filling stations, which is
 * exactly what this app gets asked about. The picker's free-text option is
 * what carries the gap.
 */
function resolveProvider(): PlacesProvider {
  const configured = process.env.EXPO_PUBLIC_PLACES_PROVIDER;
  if (configured === 'photon' || configured === 'local') return configured;
  if (configured === 'google' || KEY) return KEY ? 'google' : 'local';
  return 'local';
}

export const placesProvider = resolveProvider();

export const providerLabel: Record<PlacesProvider, string> = {
  google: 'Google Places',
  photon: 'OpenStreetMap',
  local: 'Saved places',
};

export const hasLivePlaces = placesProvider !== 'local';

/** Bias results toward Lagos rather than returning global matches. */
const BIAS = {
  circle: {
    center: { latitude: 6.5244, longitude: 3.3792 },
    radius: 50_000,
  },
};

/** Places we can offer with no network at all. */
/**
 * Deliberately empty.
 *
 * This held nine Lagos landmarks used both as the picker's opening list and
 * as the fallback when live search is unavailable. Neither is honest: a new
 * account in Kano saw filling stations in Ikeja as "saved places", and a
 * Photon outage turned a search for "market" into Oyingbo Market on Lagos
 * Island.
 *
 * The picker now opens on places the person actually asked about, and when
 * search returns nothing they can use exactly what they typed — a freeform
 * place, which is the truthful answer to "we do not know this one".
 */
export const KNOWN_PLACES: Place[] = [];


/**
 * The town or city part of a place, for use where there is only room for one
 * line. Derived from `area` rather than stored, because each provider hands
 * back a differently-shaped string:
 *
 *   saved list   "Ikeja"
 *   Photon       "Adeola Odeku, Victoria Island, Lagos"
 *   Google       "Adeola Odeku St, Victoria Island, Lagos, Nigeria"
 *
 * The last segment is the locality in every case bar Google's, which appends
 * the country — so a trailing country name is stepped over.
 */
export function localityOf(place: Place): string | null {
  if (place.freeform || !place.area) return null;

  const parts = place.area
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const last = parts[parts.length - 1];
  if (parts.length > 1 && /^nigeria$/i.test(last)) return parts[parts.length - 2];
  return last;
}

export function searchKnownPlaces(query: string): Place[] {
  const q = query.trim().toLowerCase();
  if (!q) return KNOWN_PLACES.slice(0, 6);

  return KNOWN_PLACES.map((place) => {
    const name = place.name.toLowerCase();
    const area = place.area.toLowerCase();
    if (name.startsWith(q)) return { place, score: 0 };
    if (name.includes(q)) return { place, score: 1 };
    if (area.startsWith(q)) return { place, score: 2 };
    if (area.includes(q)) return { place, score: 3 };
    return { place, score: Infinity };
  })
    .filter((r) => r.score !== Infinity)
    .sort((a, b) => a.score - b.score)
    .map((r) => r.place);
}

/**
 * One token spans a user's whole typing session up to the moment they pick
 * something, which is how Google groups the keystrokes into a single billable
 * autocomplete session instead of charging per request.
 */
export function newSessionToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export type SearchOutcome = {
  places: Place[];
  /** False when results came from the built-in list. */
  live: boolean;
  /** Set when a live lookup failed and the built-in list was used instead. */
  error?: string;
};

type AutocompleteResponse = {
  suggestions?: {
    placePrediction?: {
      placeId?: string;
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
      text?: { text?: string };
    };
  }[];
};

type PhotonResponse = {
  features?: {
    geometry?: { coordinates?: [number, number] };
    properties?: {
      osm_id?: number;
      osm_type?: string;
      name?: string;
      street?: string;
      district?: string;
      city?: string;
      state?: string;
      countrycode?: string;
    };
  }[];
};

async function searchPhoton(query: string, signal?: AbortSignal): Promise<SearchOutcome> {
  const url = new URL('https://photon.komoot.io/api');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '10');
  url.searchParams.set('lang', 'en');
  // Bias toward Lagos; Photon ranks by distance from this point.
  url.searchParams.set('lat', '6.5244');
  url.searchParams.set('lon', '3.3792');

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) {
    return {
      places: searchKnownPlaces(query),
      live: false,
      error: `OpenStreetMap lookup failed (${response.status}).`,
    };
  }

  const data: PhotonResponse = await response.json();
  const all = (data.features ?? [])
    .map((feature, index) => {
      const p = feature.properties ?? {};
      const name = p.name ?? p.street ?? p.city;
      if (!name) return null;

      const area = [p.street !== name ? p.street : null, p.district, p.city, p.state]
        .filter(Boolean)
        .join(', ');

      const coordinates = feature.geometry?.coordinates;
      return {
        place: {
          id: p.osm_id ? `${p.osm_type ?? 'X'}${p.osm_id}` : `photon-${index}`,
          name,
          area,
          coords: coordinates
            ? { lat: coordinates[1], lng: coordinates[0] }
            : undefined,
        } satisfies Place,
        nigerian: p.countrycode === 'NG',
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  // Prefer local hits, but never return nothing just because the match sits
  // outside Nigeria — the user may well be asking about somewhere else.
  const nigerian = all.filter((r) => r.nigerian).map((r) => r.place);
  return { places: nigerian.length > 0 ? nigerian : all.map((r) => r.place), live: true };
}

export async function searchPlaces(
  query: string,
  options: { signal?: AbortSignal; sessionToken?: string } = {},
): Promise<SearchOutcome> {
  const trimmed = query.trim();

  if (placesProvider === 'local' || trimmed.length < 2) {
    return { places: searchKnownPlaces(trimmed), live: false };
  }

  if (placesProvider === 'photon') {
    try {
      return await searchPhoton(trimmed, options.signal);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { places: [], live: true };
      }
      return {
        places: searchKnownPlaces(trimmed),
        live: false,
        error: 'No connection to OpenStreetMap. Showing saved places.',
      };
    }
  }

  // Unreachable in practice — the provider only resolves to google when a key
  // is present — but it is what proves KEY is a string to the type checker.
  if (!KEY) return { places: searchKnownPlaces(trimmed), live: false };

  try {
    const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      signal: options.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': KEY,
      },
      body: JSON.stringify({
        input: trimmed,
        locationBias: BIAS,
        includedRegionCodes: ['ng'],
        sessionToken: options.sessionToken,
      }),
    });

    if (!response.ok) {
      // 403 almost always means key restrictions or the Places API being
      // disabled — worth saying plainly rather than showing an empty list.
      const reason =
        response.status === 403
          ? 'Places key rejected. Check its API restrictions.'
          : `Places lookup failed (${response.status}).`;
      return { places: searchKnownPlaces(trimmed), live: false, error: reason };
    }

    const data: AutocompleteResponse = await response.json();
    const places = (data.suggestions ?? [])
      .map((suggestion) => suggestion.placePrediction)
      .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
      .map((p) => ({
        id: p.placeId as string,
        name: p.structuredFormat?.mainText?.text ?? p.text?.text ?? 'Unnamed place',
        area: p.structuredFormat?.secondaryText?.text ?? '',
      }));

    return { places, live: true };
  } catch (error) {
    // A cancelled request is the expected outcome of typing another letter,
    // not a failure worth reporting.
    if (error instanceof Error && error.name === 'AbortError') {
      return { places: [], live: true };
    }
    return {
      places: searchKnownPlaces(trimmed),
      live: false,
      error: 'No connection to Places. Showing saved places.',
    };
  }
}

/**
 * Turns coordinates into a name and area.
 *
 * Needed because expo-location's reverseGeocodeAsync is unsupported on web —
 * it fails there rather than returning anything, which is how "use my current
 * location" ends up labelled with the literal words "My current location".
 * This runs over the network and so works on every platform.
 *
 * Note for the Google path: reverse geocoding lives in the *Geocoding* API,
 * which is a separate product from Places and has to be enabled on the key.
 * If it is not, this returns null and the caller falls back to coordinates.
 */
export async function reverseLookup(
  coords: { lat: number; lng: number },
  signal?: AbortSignal,
): Promise<{ name: string; area: string } | null> {
  try {
    if (placesProvider === 'photon') {
      const url = new URL('https://photon.komoot.io/reverse');
      url.searchParams.set('lat', String(coords.lat));
      url.searchParams.set('lon', String(coords.lng));
      url.searchParams.set('lang', 'en');
      url.searchParams.set('limit', '1');

      const response = await fetch(url.toString(), { signal });
      if (!response.ok) return null;

      const data: PhotonResponse = await response.json();
      const p = data.features?.[0]?.properties;
      if (!p) return null;

      const name = p.name ?? p.street ?? p.district ?? p.city;
      if (!name) return null;

      const area = [p.street !== name ? p.street : null, p.district, p.city, p.state]
        .filter(Boolean)
        .join(', ');
      return { name, area };
    }

    if (placesProvider === 'google' && KEY) {
      const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
      url.searchParams.set('latlng', `${coords.lat},${coords.lng}`);
      url.searchParams.set('key', KEY);

      const response = await fetch(url.toString(), { signal });
      if (!response.ok) return null;

      const data: { results?: { formatted_address?: string }[] } = await response.json();
      const address = data.results?.[0]?.formatted_address;
      if (!address) return null;

      const parts = address.split(',').map((s) => s.trim()).filter(Boolean);
      return { name: parts[0], area: parts.slice(1).join(', ') };
    }
  } catch {
    // Falls through to null; the caller shows coordinates instead.
  }

  return null;
}

type DetailsResponse = {
  location?: { latitude?: number; longitude?: number };
  formattedAddress?: string;
};

/**
 * Fills in coordinates for a chosen place.
 *
 * Only called on selection, never while typing — Place Details is billed
 * separately from autocomplete, so resolving every suggestion as it appeared
 * would multiply the cost of a search by its result count.
 */
export async function resolvePlace(place: Place, sessionToken?: string): Promise<Place> {
  // Photon returns coordinates inline, so only Google needs a second call.
  if (placesProvider !== 'google' || !KEY || place.coords || place.freeform) return place;

  try {
    const url = new URL(`https://places.googleapis.com/v1/places/${place.id}`);
    url.searchParams.set('fields', 'location,formattedAddress');
    if (sessionToken) url.searchParams.set('sessionToken', sessionToken);

    const response = await fetch(url.toString(), {
      headers: { 'X-Goog-Api-Key': KEY },
    });
    if (!response.ok) return place;

    const data: DetailsResponse = await response.json();
    const lat = data.location?.latitude;
    const lng = data.location?.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') return place;

    return { ...place, coords: { lat, lng }, area: place.area || (data.formattedAddress ?? '') };
  } catch {
    // Coordinates are a bonus; the name is what the verifier navigates by.
    return place;
  }
}
