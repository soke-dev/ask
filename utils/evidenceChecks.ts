import { apiFetch, hasApi } from './api';

/**
 * The evidence gate, as the app sees it.
 *
 * Two kinds of check exist, split by what the phone can actually do:
 *
 *   Locally      length of a clip, how many photos, and how far the phone was
 *                from the place. All arithmetic on numbers already in hand.
 *
 *   On the API   blur, darkness, and whether the picture plausibly relates to
 *                the question. These need the pixels, and React Native has no
 *                way to read them — there is no canvas and no image decoder
 *                reachable from JS. They run on the server or not at all.
 *
 * When no backend is configured the second group is reported as `skipped` with
 * the reason, and the submission goes through. What must never happen is the
 * app claiming a photo "passed our check" when nothing looked at it — that is
 * what the screen used to do, on a two-second timer.
 */
export type Verdict = 'pass' | 'warn' | 'fail' | 'skipped';

export type EvidenceCheck = {
  name: string;
  tier: 1 | 2;
  verdict: Verdict;
  detail: string;
  score?: number;
  threshold?: number;
};

export type EvidenceReport = {
  verdict: 'pass' | 'warn' | 'fail';
  checks: EvidenceCheck[];
  attemptsLeft?: number;
};

export type Coords = { lat: number; lng: number };

export const MAX_ATTEMPTS = 3;

/** Great-circle distance in metres. Matches the server's implementation. */
export function distanceMetres(a: Coords, b: Coords): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

export function formatDistance(metres: number): string {
  return metres < 1000 ? `${metres}m` : `${(metres / 1000).toFixed(1)}km`;
}

const NEAR_METRES = 150;
const FAR_METRES = 600;

/**
 * Distance from the pin. Advisory in every case, never a rejection.
 *
 * Consumer GPS is routinely tens of metres out and far worse between tall
 * buildings; a market is much larger than the point representing it; and
 * someone standing across the road can see a queue perfectly well. This
 * produces a line of text for the asker to weigh, and nothing else.
 */
export function checkDistance(captured: Coords | null, target: Coords | null): EvidenceCheck {
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
  if (metres <= FAR_METRES) {
    return {
      name: 'distance',
      tier: 1,
      verdict: 'pass',
      score: metres,
      detail:
        metres <= NEAR_METRES
          ? `Captured ${formatDistance(metres)} from the place.`
          : `Captured ${formatDistance(metres)} from the pin, normal for a large place.`,
    };
  }

  return {
    name: 'distance',
    tier: 1,
    verdict: 'warn',
    score: metres,
    threshold: FAR_METRES,
    detail: `Captured ${formatDistance(metres)} from the place. The asker will see this.`,
  };
}

export function checkDuration(seconds: number | undefined, max: number): EvidenceCheck {
  if (seconds === undefined || seconds <= 0) {
    return {
      name: 'duration',
      tier: 1,
      verdict: 'skipped',
      detail: 'This device did not report how long the clip is.',
    };
  }
  if (seconds > max) {
    return {
      name: 'duration',
      tier: 1,
      verdict: 'fail',
      score: seconds,
      threshold: max,
      detail: `That clip is ${seconds}s. Keep it under ${max}s and record again.`,
    };
  }
  if (seconds < 2) {
    return {
      name: 'duration',
      tier: 1,
      verdict: 'fail',
      score: seconds,
      threshold: 2,
      detail: 'That clip is too short to show anything. Record a few seconds.',
    };
  }
  return { name: 'duration', tier: 1, verdict: 'pass', score: seconds, detail: `${seconds}s long.` };
}

export function summarise(checks: EvidenceCheck[]): EvidenceReport['verdict'] {
  if (checks.some((c) => c.verdict === 'fail')) return 'fail';
  if (checks.some((c) => c.verdict === 'warn')) return 'warn';
  return 'pass';
}

export type GateInput = {
  kind: 'photo' | 'video';
  files: { uri: string; seconds?: number }[];
  question: string;
  placeName: string | null;
  captured: Coords | null;
  target: Coords | null;
  taskId?: string;
};

/**
 * Runs every check available in this build and returns one report.
 *
 * The local checks always run. The server ones are attempted only when a
 * backend is configured, and any failure to reach it degrades to `skipped`
 * rather than blocking — an unreachable server is our problem, and a verifier
 * who walked to a filling station should not lose the job over it.
 */
export async function runEvidenceGate(input: GateInput): Promise<EvidenceReport> {
  const local: EvidenceCheck[] = [];

  if (input.kind === 'video') {
    local.push(checkDuration(input.files[0]?.seconds, 30));
  } else {
    local.push({
      name: 'count',
      tier: 1,
      verdict: input.files.length > 0 ? 'pass' : 'fail',
      score: input.files.length,
      detail:
        input.files.length > 0
          ? `${input.files.length} photo${input.files.length === 1 ? '' : 's'} attached.`
          : 'No photo was attached.',
    });
  }

  local.push(checkDistance(input.captured, input.target));

  // A local failure stops here. There is no sense uploading a 30MB clip that
  // is already going to be sent back, on a connection the verifier is paying
  // for by the megabyte.
  if (summarise(local) === 'fail') {
    return {
      verdict: 'fail',
      checks: [...local, pixelChecksSkipped('Not checked yet — fix the above and it runs.')],
    };
  }

  if (!hasApi) {
    return {
      verdict: summarise(local),
      checks: [
        ...local,
        pixelChecksSkipped('Not checked for blur or lighting — this build has no server.'),
      ],
    };
  }

  const form = new FormData();
  form.append('kind', input.kind);
  form.append('question', input.question);
  if (input.placeName) form.append('placeName', input.placeName);
  if (input.taskId) form.append('taskId', input.taskId);
  if (input.captured) {
    form.append('capturedLat', String(input.captured.lat));
    form.append('capturedLng', String(input.captured.lng));
  }
  if (input.target) {
    form.append('targetLat', String(input.target.lat));
    form.append('targetLng', String(input.target.lng));
  }
  input.files.forEach((file, i) => {
    form.append('files', {
      uri: file.uri,
      name: input.kind === 'video' ? `clip-${i}.mp4` : `photo-${i}.jpg`,
      type: input.kind === 'video' ? 'video/mp4' : 'image/jpeg',
    } as unknown as Blob);
  });

  const result = await apiFetch<EvidenceReport>('/evidence/check', { method: 'POST', body: form });

  if (!result.ok) {
    return {
      verdict: summarise(local),
      checks: [...local, pixelChecksSkipped(`Not checked for blur or lighting — ${result.detail}`)],
    };
  }

  // The server measured the distance too, and its answer supersedes the local
  // one so there is only ever a single distance line.
  const serverChecks = result.data.checks ?? [];
  const merged = [
    ...local.filter((c) => !serverChecks.some((s) => s.name === c.name)),
    ...serverChecks,
  ];

  return {
    verdict: summarise(merged),
    checks: merged,
    attemptsLeft: result.data.attemptsLeft,
  };
}

function pixelChecksSkipped(detail: string): EvidenceCheck {
  return { name: 'clarity', tier: 2, verdict: 'skipped', detail };
}
