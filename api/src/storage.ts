import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from './config.js';

/**
 * Where evidence files live.
 *
 * The disk driver is for local development only, and it must not survive the
 * move to Railway. Railway containers have an ephemeral filesystem: it is
 * wiped on every deploy and every restart. Evidence written there would
 * disappear partway through a dispute, which is the exact moment it matters
 * most — the reviewer would be asked to judge a photo that no longer exists.
 *
 * Before the API is deployed this needs an object-store driver (Cloudflare R2,
 * Backblaze B2, or S3). The interface below is deliberately the small part of
 * S3 that every one of them implements, so adding it is a new `put` and
 * nothing else changes.
 */
export type StoredFile = { key: string; bytes: number };

export interface Storage {
  put(buffer: Buffer, contentType: string): Promise<StoredFile>;
  urlFor(key: string): string;
}

class DiskStorage implements Storage {
  async put(buffer: Buffer, contentType: string): Promise<StoredFile> {
    const ext = contentType.includes('video') ? 'mp4' : 'jpg';
    const key = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;
    const path = join(config.storageDir, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buffer);
    return { key, bytes: buffer.byteLength };
  }

  urlFor(key: string): string {
    return `/media/${key}`;
  }
}

export const storage: Storage = new DiskStorage();

/** True when the configured driver would lose files on deploy. */
export const storageIsEphemeral = config.storageDriver === 'disk';
