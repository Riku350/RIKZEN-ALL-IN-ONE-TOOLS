import { Router } from 'express';
import {
  AuthRequest,
  adminDb,
  isAdminUser,
  optionalAuth,
  requireAuth,
} from '../firebaseAdmin.ts';
import {
  deleteTempFile,
  getTempFile,
  sanitizeFilename,
  verifyDownloadToken,
} from '../tempStorage.ts';
import { streamTempFile } from './download.ts';

const router = Router();

router.get('/:fileId/download', optionalAuth, async (req: AuthRequest, res) => {
  const { fileId } = req.params;
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const record = getTempFile(fileId);

  if (!record) {
    res.status(410).json({
      code: 'FILE_EXPIRED',
      error: 'This file has expired.',
    });
    return;
  }

  // Strict privacy guard: if file belongs to a user, require matching owner OR valid signed token from that operation
  const isOwner = Boolean(req.user && record.ownerUid && req.user.uid === record.ownerUid);
  const hasValidToken = Boolean(token && verifyDownloadToken(fileId, token, record.expiresAt));

  if (record.ownerUid) {
    if (!isOwner && !hasValidToken) {
      res.status(403).json({
        code: 'INVALID_DOWNLOAD_TOKEN',
        error: 'You do not have permission to access this file.',
      });
      return;
    }
  } else if (!hasValidToken) {
    res.status(403).json({
      code: 'INVALID_DOWNLOAD_TOKEN',
      error: 'Invalid or missing download token.',
    });
    return;
  }

  const inline = req.query.inline === '1';
  await streamTempFile(record, inline, res);
});

router.delete('/:fileId', requireAuth, async (req: AuthRequest, res) => {
  const { fileId } = req.params;
  const uid = req.user!.uid;

  try {
    const docRef = adminDb.collection('files').doc(fileId);
    const snap = await docRef.get();
    if (snap.exists) {
      const data = snap.data();
      const admin = await isAdminUser(req.user);
      if (data?.userId !== uid && !admin) {
        res.status(403).json({ error: 'You cannot delete another user’s file.' });
        return;
      }
      if (data?.serverFileId) {
        await deleteTempFile(data.serverFileId);
      }
      await docRef.delete();
    } else {
      const temp = getTempFile(fileId);
      if (temp && temp.ownerUid === uid) {
        await deleteTempFile(fileId);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete file error:', err);
    res.status(500).json({ error: 'Could not delete file. Please try again.' });
  }
});

router.patch('/:fileId', requireAuth, async (req: AuthRequest, res) => {
  const { fileId } = req.params;
  const uid = req.user!.uid;
  const nextName = typeof req.body?.fileName === 'string' ? sanitizeFilename(req.body.fileName) : '';

  if (!nextName) {
    res.status(400).json({ error: 'Please provide a valid file name.' });
    return;
  }

  try {
    const docRef = adminDb.collection('files').doc(fileId);
    const snap = await docRef.get();
    if (!snap.exists) {
      res.status(404).json({ error: 'File record not found.' });
      return;
    }
    const data = snap.data();
    if (data?.userId !== uid) {
      res.status(403).json({ error: 'You cannot rename another user’s file.' });
      return;
    }
    await docRef.update({ fileName: nextName });
    res.json({ ok: true, fileName: nextName });
  } catch (err) {
    console.error('Rename file error:', err);
    res.status(500).json({ error: 'Could not rename file.' });
  }
});

export default router;
