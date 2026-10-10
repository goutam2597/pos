import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { handler, ok } from '../lib/http.js';
import { AppError } from '../lib/errors.js';
import { uploadsDir } from '../lib/uploads.js';

/**
 * File uploads.
 *
 * Product images are the only uploads today, so the endpoint is deliberately
 * narrow: one file per request, images only, 5 MB ceiling, and the filename is
 * minted here — never taken from the client, which could carry a path trick or
 * overwrite another file. The URL returned is server-relative (`/uploads/…`)
 * so it works through the web proxy in development and behind any reverse
 * proxy that forwards `/uploads` in production.
 */

// Declared content types we accept, mapped to a canonical extension.
const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

/** Magic bytes per accepted type: the declared mime must match the payload. */
function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  // RIFF….WEBP
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp';
  }
  // ftypavif
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70 && bytes[8] === 0x61 && bytes[9] === 0x76 && bytes[10] === 0x69 && bytes[11] === 0x66) {
    return 'image/avif';
  }
  return null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 5 * 1024 * 1024 },
});

export const uploadRouter = Router();

uploadRouter.post(
  '/',
  upload.single('file'),
  handler(async (req, res) => {
    const file = req.file;
    if (!file) {
      throw new AppError('VALIDATION_FAILED', 'Attach an image in the "file" field');
    }

    // Multer's filter runs before the buffer is complete, so the mime check
    // happens here: trust the file's actual bytes, not the client's header.
    const sniffed = sniffImageMime(file.buffer);
    if (!sniffed || !IMAGE_TYPES[sniffed]) {
      throw new AppError('VALIDATION_FAILED', 'Only JPEG, PNG, WebP, GIF or AVIF images are accepted');
    }

    const name = `${Date.now().toString(36)}-${randomUUID()}${IMAGE_TYPES[sniffed]}`;
    await writeFile(path.join(uploadsDir, name), file.buffer);

    ok(res, { url: `/uploads/${name}`, size: file.size, type: sniffed });
  }),
);

// Multer surfaces an over-limit file as its own error shape; translate it so
// the client sees the standard envelope instead of an HTML error page.
uploadRouter.use((error: unknown, _req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    res.status(422).json({ error: { code: 'VALIDATION_FAILED', message: 'Image must be 5 MB or smaller' } });
    return;
  }
  next(error);
});
