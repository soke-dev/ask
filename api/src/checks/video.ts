import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { config } from '../config.js';
import { judgeImage, measureImage, type ImageStats } from './image.js';
import type { CheckResult } from './types.js';

export type VideoProbe = {
  durationSeconds: number;
  width: number;
  height: number;
  hasAudio: boolean;
};

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(err.trim() || `exited ${code}`)),
    );
  });
}

export async function probeVideo(path: string): Promise<VideoProbe> {
  const raw = await run(ffprobeStatic.path, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    path,
  ]);

  const parsed = JSON.parse(raw) as {
    format?: { duration?: string };
    streams?: { codec_type?: string; width?: number; height?: number }[];
  };

  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');

  return {
    durationSeconds: Number(parsed.format?.duration ?? 0),
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
  };
}

/**
 * Pulls evenly spaced frames out of a clip.
 *
 * The first and last moments are skipped — a clip almost always starts with
 * the phone still moving toward the subject and ends with it moving away, so
 * those frames are the blurriest and the least representative of what was
 * actually filmed.
 */
export async function extractFrames(path: string, duration: number, count: number) {
  const dir = await mkdtemp(join(tmpdir(), 'confam-frames-'));
  try {
    const frames: Buffer[] = [];
    for (let i = 0; i < count; i += 1) {
      const at = (duration * (i + 1)) / (count + 1);
      const out = join(dir, `frame-${i}.jpg`);
      try {
        await run(ffmpegPath as unknown as string, [
          '-ss', at.toFixed(2),
          '-i', path,
          '-frames:v', '1',
          '-q:v', '3',
          '-y', out,
        ]);
        frames.push(await readFile(out));
      } catch {
        // A frame that will not decode is not fatal; the others still measure.
      }
    }
    return frames;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export type VideoAnalysis = {
  probe: VideoProbe;
  checks: CheckResult[];
  /** The sharpest frame, for the relevance check to look at. */
  bestFrame: Buffer | null;
};

/**
 * Measures a clip: length first, then the sharpest frame it contains.
 *
 * Sharpness is judged on the *best* frame rather than the average. Motion blur
 * on some frames of a hand-held clip is normal and not the verifier's fault —
 * what matters is whether the clip contains a moment that shows the thing
 * clearly. Averaging would fail honest evidence for being filmed while walking.
 */
export async function analyseVideo(buffer: Buffer): Promise<VideoAnalysis> {
  const dir = await mkdtemp(join(tmpdir(), 'confam-video-'));
  const path = join(dir, 'clip.mp4');

  try {
    await writeFile(path, buffer);
    const probe = await probeVideo(path);
    const checks: CheckResult[] = [];
    const { minVideoSeconds, maxVideoSeconds } = config.media;

    if (probe.durationSeconds > maxVideoSeconds + 0.5) {
      checks.push({
        name: 'duration',
        tier: 1,
        verdict: 'fail',
        score: round(probe.durationSeconds),
        threshold: maxVideoSeconds,
        detail: `That clip is ${Math.round(probe.durationSeconds)}s. Keep it under ${maxVideoSeconds}s.`,
      });
    } else if (probe.durationSeconds < minVideoSeconds) {
      checks.push({
        name: 'duration',
        tier: 1,
        verdict: 'fail',
        score: round(probe.durationSeconds),
        threshold: minVideoSeconds,
        detail: 'That clip is too short to show anything. Record a few seconds.',
      });
    } else {
      checks.push({
        name: 'duration',
        tier: 1,
        verdict: 'pass',
        score: round(probe.durationSeconds),
        detail: `${Math.round(probe.durationSeconds)}s long.`,
      });
    }

    const frames = await extractFrames(path, probe.durationSeconds, config.video.framesSampled);
    if (frames.length === 0) {
      checks.push({
        name: 'sharpness',
        tier: 1,
        verdict: 'skipped',
        detail: 'No frame could be read from this clip.',
      });
      return { probe, checks, bestFrame: null };
    }

    const measured: { buffer: Buffer; stats: ImageStats }[] = [];
    for (const frame of frames) {
      measured.push({ buffer: frame, stats: await measureImage(frame) });
    }
    measured.sort((a, b) => b.stats.sharpness - a.stats.sharpness);
    const best = measured[0]!;

    checks.push(...judgeImage(best.stats, 'clip'));
    return { probe, checks, bestFrame: best.buffer };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function round(n: number, places = 1): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
