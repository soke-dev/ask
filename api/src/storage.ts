import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from './config.js';

/**
 * Where evidence files live.
 *
 * Three drivers, and the distinction that matters is not disk-versus-cloud but
 * whether the bytes survive a deploy:
 *
 *   disk    a folder in the container. Development only. Railway wipes the
 *           container filesystem on every deploy and restart, so evidence
 *           written here disappears partway through a dispute — the exact
 *           moment it matters most.
 *
 *   volume  the same folder, on a Railway Volume mounted into the container.
 *           Same code, same `put`, but the bytes outlive the deploy. This is
 *           what production runs on today.
 *
 *   object  R2/S3. Not written yet. The interface below is deliberately the
 *           small part of S3 that every provider implements, so adding it is
 *           a new `put` and nothing else changes.
 *
 * A volume is one machine's disk, so it rules out running two API replicas —
 * fine now, and the reason the object driver still has a place to go later.
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

/**
 * True when the configured driver would lose files on deploy.
 *
 * Only bare `disk`. A volume is disk-backed too, and reading that as ephemeral
 * is what would make the health endpoint tell a deployed server it is about to
 * lose evidence it is not going to lose.
 */
export const storageIsEphemeral = config.storageDriver === 'disk';

/**
 * True when this process serves the files itself, rather than handing out
 * links to somebody else's bucket. Both local drivers do; `object` will not.
 */
export const storageIsLocal =
  config.storageDriver === 'disk' || config.storageDriver === 'volume';
