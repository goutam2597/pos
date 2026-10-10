import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Where uploaded files live.
 *
 * Resolved relative to this module so it is correct whether the server runs
 * from `src` (tsx watch) or `dist`, overridable with UPLOAD_DIR for a volume
 * mount in production. The directory is created eagerly at boot: a missing
 * directory would otherwise turn the first upload into a 500.
 */
const defaultDir = path.join(fileURLToPath(new URL('../../', import.meta.url)), 'uploads');

export const uploadsDir = process.env.UPLOAD_DIR?.trim() || defaultDir;

export function ensureUploadsDir(): void {
  mkdirSync(uploadsDir, { recursive: true });
}
