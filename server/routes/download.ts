import { Response, Router } from 'express';
import fs from 'fs';
import { AuthRequest, optionalAuth } from '../firebaseAdmin.ts';
import {
  StoredTempFile,
  buildContentDisposition,
  parseAndVerifySecureToken,
} from '../tempStorage.ts';

const router = Router();

export async function streamTempFile(
  record: StoredTempFile,
  inline: boolean,
  res: Response
): Promise<void> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(record.filePath);
  } catch {
    res.status(410).json({
      code: 'FILE_EXPIRED',
      error: 'This file has expired.',
    });
    return;
  }

  res.setHeader('Content-Type', record.mimeType || 'application/octet-stream');
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('Content-Disposition', buildContentDisposition(record.fileName, inline));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const stream = fs.createReadStream(record.filePath);
  stream.on('error', (err) => {
    console.error('File stream error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to read file from temporary storage.' });
    } else {
      res.end();
    }
  });
  stream.pipe(res);
}

/**
 * GET /api/download/:secureToken
 * Cookie-free, capability-signed temporary file delivery endpoint.
 * Does NOT force re-authentication; validates HMAC signature, expiration,
 * and ensures logged-in users cannot download another user's private file.
 */
router.get('/:secureToken', optionalAuth, async (req: AuthRequest, res) => {
  const { secureToken } = req.params;
  const check = parseAndVerifySecureToken(secureToken);

  if (!check.valid) {
    if (check.reason === 'expired') {
      res.status(410).json({
        code: 'FILE_EXPIRED',
        error: 'This file has expired.',
      });
      return;
    }
    res.status(403).json({
      code: 'INVALID_DOWNLOAD_TOKEN',
      error: 'Invalid or tampered download link.',
    });
    return;
  }

  const record = check.record;

  // Extra safeguard: if request carries an authenticated Firebase user that differs from ownerUid, deny
  if (record.ownerUid && req.user && req.user.uid !== record.ownerUid) {
    res.status(403).json({
      code: 'FORBIDDEN',
      error: 'You do not have permission to access this file.',
    });
    return;
  }

  const inline = req.query.inline === '1';
  await streamTempFile(record, inline, res);
});

export default router;
