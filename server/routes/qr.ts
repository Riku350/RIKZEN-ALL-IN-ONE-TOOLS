import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import multer from 'multer';
import express from 'express';
import QRCode from 'qrcode';
import PDFKitDocument from 'pdfkit';
import { FieldValue } from 'firebase-admin/firestore';
import {
  AuthRequest,
  adminDb,
  isAdminUser,
  optionalAuth,
  requireAuth,
} from '../firebaseAdmin.ts';
import {
  buildContentDisposition,
  getDownloadUrls,
  sanitizeFilename,
  saveTempFile,
} from '../tempStorage.ts';
import {
  QrContentType,
  QrDesignConfig,
  QrExpirationPreset,
  QrShareRecord,
  deleteQrRecord,
  generateShareId,
  getQrLimits,
  getQrRecord,
  getUserQrStorageBytes,
  isRecordExpired,
  isValidShareId,
  listUserQrRecords,
  probeVideoMetadata,
  processAndStoreQrImage,
  resolveExpirationMs,
  saveQrRecord,
  storeQrVideoOrFile,
  updateQrRecord,
  validateGeneralFileSignature,
  validateVideoMagicBytes,
} from '../qrStorage.ts';

const router = Router();

const UPLOAD_TMP_DIR = path.join(os.tmpdir(), 'rikzen-qr-upload-tmp');
if (!fs.existsSync(UPLOAD_TMP_DIR)) {
  fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
}

const limits = getQrLimits();
const MAX_UPLOAD_DISK_BYTES = Math.max(limits.maxQrVideoMb, limits.maxQrFileMb, limits.maxQrImageMb) * 1024 * 1024;

const qrUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_TMP_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10);
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: {
    fileSize: MAX_UPLOAD_DISK_BYTES,
    files: 2,
  },
});

function handleQrMulterError(err: unknown, _req: Request, res: Response, next: NextFunction) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      const currentLimits = getQrLimits();
      res.status(413).json({
        code: 'FILE_TOO_LARGE',
        error: `File exceeds the maximum upload limit (${currentLimits.maxQrVideoMb} MB for video, ${currentLimits.maxQrFileMb} MB for files, ${currentLimits.maxQrImageMb} MB for images).`,
      });
      return;
    }
    res.status(400).json({ code: 'UPLOAD_ERROR', error: 'Could not read the uploaded file.' });
    return;
  }
  next(err);
}

function getBaseOrigin(req: Request): string {
  const originHeader = req.headers.origin;
  if (originHeader) {
    try {
      const parsed = new URL(originHeader);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return parsed.origin;
      }
    } catch {
      // ignore invalid origin
    }
  }
  const host = req.get('host');
  if (host) {
    return `${req.protocol}://${host}`;
  }
  const envUrl = process.env.APP_URL;
  if (envUrl && envUrl !== 'MY_APP_URL') {
    return envUrl.replace(/\/+$/, '');
  }
  return 'http://localhost:3000';
}

function parseExpirationPreset(val: unknown): QrExpirationPreset {
  const v = String(val || 'never').toLowerCase();
  if (v === '1d' || v === '7d' || v === '30d' || v === 'custom') return v;
  return 'never';
}

function parseDesign(raw: unknown): QrDesignConfig | undefined {
  if (!raw) return undefined;
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!obj || typeof obj !== 'object') return undefined;
    return obj as QrDesignConfig;
  } catch {
    return undefined;
  }
}

function toPublicRecord(rec: QrShareRecord) {
  return {
    shareId: rec.shareId,
    name: rec.name,
    qrType: rec.qrType,
    payload: rec.payload,
    shareUrl: rec.shareUrl,
    fileName: rec.fileName || null,
    mimeType: rec.mimeType || null,
    sizeBytes: rec.sizeBytes || 0,
    durationSec: rec.durationSec ?? null,
    width: rec.width ?? null,
    height: rec.height ?? null,
    hasThumbnail: Boolean(rec.thumbnailPath),
    mediaUrl: rec.filePath ? `/api/qr/media/${rec.shareId}` : null,
    downloadUrl: rec.filePath ? `/api/qr/media/${rec.shareId}?download=1` : null,
    thumbnailUrl: rec.thumbnailPath ? `/api/qr/media/${rec.shareId}?thumb=1` : null,
    design: rec.design || null,
    expirationPreset: rec.expirationPreset,
    expiresAt: rec.expiresAt,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

async function bestEffortLogQrAnalytics(qrType: QrContentType, uid: string | null) {
  try {
    await adminDb.collection('analytics_events').add({
      event: 'processing_completed',
      toolId: 'qr-generator',
      category: 'utility',
      qrType,
      authenticated: Boolean(uid),
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch {
    // Analytics must never fail request
  }
}

// 1. Upload media (Image / Video / File) -> Secure RIKZEN share URL -> QR
router.post(
  '/upload',
  optionalAuth,
  qrUpload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 },
  ]),
  handleQrMulterError,
  async (req: AuthRequest, res: Response) => {
    const files = (req.files || {}) as Record<string, Express.Multer.File[]>;
    const mainFile = files.file?.[0];
    const thumbFile = files.thumbnail?.[0];

    const cleanupTemps = async () => {
      if (mainFile?.path) await fs.promises.unlink(mainFile.path).catch(() => {});
      if (thumbFile?.path) await fs.promises.unlink(thumbFile.path).catch(() => {});
    };

    try {
      if (!mainFile) {
        await cleanupTemps();
        res.status(400).json({ error: 'Please select a file to upload.' });
        return;
      }

      const rawType = String(req.body?.qrType || '').toLowerCase();
      if (!['image', 'video', 'file'].includes(rawType)) {
        await cleanupTemps();
        res.status(400).json({ error: 'Invalid QR media type. Choose image, video, or file.' });
        return;
      }
      const qrType = rawType as 'image' | 'video' | 'file';

      const currentLimits = getQrLimits();
      const maxTypeMb =
        qrType === 'image'
          ? currentLimits.maxQrImageMb
          : qrType === 'video'
          ? currentLimits.maxQrVideoMb
          : currentLimits.maxQrFileMb;

      if (mainFile.size > maxTypeMb * 1024 * 1024) {
        await cleanupTemps();
        res.status(413).json({
          code: 'FILE_TOO_LARGE',
          error: `File is ${(mainFile.size / (1024 * 1024)).toFixed(1)} MB. Max allowed for ${qrType} QR is ${maxTypeMb} MB.`,
        });
        return;
      }

      // Per-user storage quota enforcement
      if (req.user?.uid) {
        const usedBytes = getUserQrStorageBytes(req.user.uid);
        const quotaBytes = currentLimits.maxQrStoragePerUserMb * 1024 * 1024;
        if (usedBytes + mainFile.size > quotaBytes) {
          await cleanupTemps();
          res.status(413).json({
            code: 'QUOTA_EXCEEDED',
            error: `This upload exceeds your ${currentLimits.maxQrStoragePerUserMb} MB QR storage quota. Delete old QR files or choose an expiration date.`,
          });
          return;
        }
      }

      const shareId = generateShareId();
      const baseOrigin = getBaseOrigin(req);
      const shareUrl = `${baseOrigin}/q/${shareId}`;
      const cleanTitle =
        String(req.body?.name || '').trim().slice(0, 140) ||
        sanitizeFilename(mainFile.originalname, `RIKZEN ${qrType.toUpperCase()} QR`).replace(/\.[^.]+$/, '');
      const expirationPreset = parseExpirationPreset(req.body?.expiration);
      const expiresAt = resolveExpirationMs(expirationPreset, req.body?.customExpiresAt);
      const design = parseDesign(req.body?.design);

      let storedFilePath = '';
      let storedThumbPath: string | undefined;
      let storedFileName = sanitizeFilename(mainFile.originalname);
      let storedMimeType = mainFile.mimetype || 'application/octet-stream';
      let storedSizeBytes = mainFile.size;
      let width: number | null = null;
      let height: number | null = null;
      let durationSec: number | null = null;

      if (qrType === 'image') {
        const processed = await processAndStoreQrImage(mainFile.path, shareId, mainFile.originalname);
        storedFilePath = processed.filePath;
        storedThumbPath = processed.thumbnailPath;
        storedFileName = processed.fileName;
        storedMimeType = processed.mimeType;
        storedSizeBytes = processed.sizeBytes;
        width = processed.width;
        height = processed.height;
      } else if (qrType === 'video') {
        const check = await validateVideoMagicBytes(mainFile.path);
        if (!check.valid) {
          await cleanupTemps();
          res.status(400).json({
            error: 'Unsupported or invalid video file. Please upload a valid MP4, MOV, or WebM video.',
          });
          return;
        }
        const probed = await probeVideoMetadata(mainFile.path);
        const clientDur = Number(req.body?.clientDurationSec);
        durationSec =
          probed.durationSec ??
          (Number.isFinite(clientDur) && clientDur > 0 ? Math.round(clientDur * 10) / 10 : null);
        width = probed.width;
        height = probed.height;

        const stored = await storeQrVideoOrFile({
          tempPath: mainFile.path,
          thumbTempPath: thumbFile?.path,
          shareId,
          originalName: mainFile.originalname,
          mimeType: check.detectedMime || mainFile.mimetype || 'video/mp4',
        });
        storedFilePath = stored.filePath;
        storedThumbPath = stored.thumbnailPath;
        storedFileName = stored.fileName;
        storedMimeType = check.detectedMime || 'video/mp4';
        storedSizeBytes = stored.sizeBytes;
      } else {
        const ext = path.extname(mainFile.originalname || '');
        const sig = await validateGeneralFileSignature(mainFile.path, mainFile.mimetype, ext);
        if (!sig.valid) {
          await cleanupTemps();
          res.status(400).json({
            error: 'Executable or unsafe script files cannot be shared via QR. Please upload PDF, document, archive, or text files.',
          });
          return;
        }
        const stored = await storeQrVideoOrFile({
          tempPath: mainFile.path,
          shareId,
          originalName: mainFile.originalname,
          mimeType: sig.safeMime,
        });
        storedFilePath = stored.filePath;
        storedFileName = stored.fileName;
        storedMimeType = sig.safeMime;
        storedSizeBytes = stored.sizeBytes;
      }

      const now = Date.now();
      const record: QrShareRecord = {
        shareId,
        ownerUid: req.user?.uid || null,
        name: cleanTitle,
        qrType,
        payload: shareUrl,
        shareUrl,
        filePath: storedFilePath,
        thumbnailPath: storedThumbPath,
        fileName: storedFileName,
        mimeType: storedMimeType,
        sizeBytes: storedSizeBytes,
        durationSec,
        width,
        height,
        design,
        expirationPreset,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      };

      await saveQrRecord(record);
      void bestEffortLogQrAnalytics(qrType, req.user?.uid || null);

      await cleanupTemps();
      res.json({
        ok: true,
        record: toPublicRecord(record),
      });
    } catch (err) {
      await cleanupTemps();
      console.error('QR upload error:', err);
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Could not process uploaded file for QR.',
      });
    }
  }
);

// 2. Create / save structured QR record (Link, Text, Contact, Wi-Fi, Email, Phone, Location)
router.post('/create', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const rawType = String(req.body?.qrType || '').toLowerCase();
    const allowedTypes: QrContentType[] = [
      'link',
      'text',
      'contact',
      'wifi',
      'email',
      'phone',
      'location',
    ];
    if (!allowedTypes.includes(rawType as QrContentType)) {
      res.status(400).json({ error: 'Invalid QR content type.' });
      return;
    }
    const qrType = rawType as QrContentType;
    const payload = String(req.body?.payload || '').trim();
    if (!payload) {
      res.status(400).json({ error: 'QR content cannot be empty.' });
      return;
    }
    if (payload.length > 4000) {
      res.status(400).json({ error: 'QR content exceeds the 4,000 character limit.' });
      return;
    }

    const name = String(req.body?.name || '').trim().slice(0, 140) || `RIKZEN ${qrType.toUpperCase()} QR`;
    const expirationPreset = parseExpirationPreset(req.body?.expiration);
    const expiresAt = resolveExpirationMs(expirationPreset, req.body?.customExpiresAt);
    const design = parseDesign(req.body?.design);

    const shareId = generateShareId();
    const baseOrigin = getBaseOrigin(req);
    const shareUrl = `${baseOrigin}/q/${shareId}`;
    const now = Date.now();

    const record: QrShareRecord = {
      shareId,
      ownerUid: req.user?.uid || null,
      name,
      qrType,
      payload,
      shareUrl,
      sizeBytes: Buffer.byteLength(payload, 'utf8'),
      design,
      expirationPreset,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    };

    await saveQrRecord(record);
    void bestEffortLogQrAnalytics(qrType, req.user?.uid || null);

    res.json({
      ok: true,
      record: toPublicRecord(record),
    });
  } catch (err) {
    console.error('QR create error:', err);
    res.status(500).json({ error: 'Could not save QR code.' });
  }
});

// 3. Public QR content metadata endpoint (opened when anyone scans /q/:shareId)
router.get('/public/:shareId', (req: Request, res: Response) => {
  const { shareId } = req.params;
  if (!isValidShareId(shareId)) {
    res.status(404).json({ code: 'QR_NOT_FOUND', error: 'QR code was not found.' });
    return;
  }

  const record = getQrRecord(shareId);
  if (!record) {
    res.status(404).json({ code: 'QR_NOT_FOUND', error: 'QR code was not found or was deleted.' });
    return;
  }

  if (isRecordExpired(record)) {
    void deleteQrRecord(shareId);
    res.status(410).json({ code: 'QR_EXPIRED', error: 'This QR content has expired.' });
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    record: toPublicRecord(record),
  });
});

// 4. Public media stream & mobile-safe download with HTTP Range (206 Partial Content) support
router.get('/media/:shareId', async (req: Request, res: Response) => {
  const { shareId } = req.params;
  if (!isValidShareId(shareId)) {
    res.status(404).json({ code: 'QR_NOT_FOUND', error: 'QR media was not found.' });
    return;
  }

  const record = getQrRecord(shareId);
  if (!record) {
    res.status(404).json({ code: 'QR_NOT_FOUND', error: 'QR media was not found.' });
    return;
  }

  if (isRecordExpired(record)) {
    await deleteQrRecord(shareId);
    res.status(410).json({ code: 'QR_EXPIRED', error: 'This QR content has expired.' });
    return;
  }

  const wantThumb = req.query.thumb === '1';
  if (wantThumb) {
    if (!record.thumbnailPath || !fs.existsSync(record.thumbnailPath)) {
      res.status(404).json({ error: 'Thumbnail not available.' });
      return;
    }
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(record.thumbnailPath).pipe(res);
    return;
  }

  if (!record.filePath || !fs.existsSync(record.filePath)) {
    res.status(404).json({ error: 'Media file not found.' });
    return;
  }

  const stat = await fs.promises.stat(record.filePath);
  const fileSize = stat.size;
  const forceDownload = req.query.download === '1';
  const mimeType = forceDownload && record.qrType === 'file'
    ? record.mimeType || 'application/octet-stream'
    : record.mimeType || 'application/octet-stream';

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mimeType);
  res.setHeader(
    'Content-Disposition',
    buildContentDisposition(record.fileName || `rikzen-qr-${shareId}`, !forceDownload)
  );
  if (forceDownload) {
    res.setHeader('Cache-Control', 'no-store');
  }

  const rangeHeader = req.headers.range;
  if (rangeHeader && !forceDownload) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!match) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }

    const start = match[1] ? parseInt(match[1], 10) : 0;
    const requestedEnd = match[2] ? parseInt(match[2], 10) : fileSize - 1;
    const end = Math.min(requestedEnd, fileSize - 1);

    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= fileSize) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }

    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Content-Length', chunkSize);
    fs.createReadStream(record.filePath, { start, end }).pipe(res);
    return;
  }

  res.setHeader('Content-Length', fileSize);
  fs.createReadStream(record.filePath).pipe(res);
});

// 5. Authenticated User Dashboard endpoints ("My QR Codes")
router.get('/my', requireAuth, (req: AuthRequest, res: Response) => {
  const uid = req.user!.uid;
  const records = listUserQrRecords(uid).map(toPublicRecord);
  const usedBytes = getUserQrStorageBytes(uid);
  const currentLimits = getQrLimits();
  res.json({
    ok: true,
    records,
    storage: {
      usedBytes,
      limitBytes: currentLimits.maxQrStoragePerUserMb * 1024 * 1024,
    },
  });
});

router.patch('/:shareId', requireAuth, async (req: AuthRequest, res: Response) => {
  const { shareId } = req.params;
  if (!isValidShareId(shareId)) {
    res.status(404).json({ error: 'QR code not found.' });
    return;
  }

  const existing = getQrRecord(shareId);
  if (!existing) {
    res.status(404).json({ error: 'QR code not found.' });
    return;
  }

  const admin = await isAdminUser(req.user);
  if (existing.ownerUid !== req.user!.uid && !admin) {
    res.status(403).json({ error: 'You do not have permission to edit this QR code.' });
    return;
  }

  const updates: Parameters<typeof updateQrRecord>[1] = {};
  if (typeof req.body?.name === 'string' && req.body.name.trim()) {
    updates.name = req.body.name.trim().slice(0, 140);
  }
  if (
    typeof req.body?.payload === 'string' &&
    req.body.payload.trim() &&
    !['image', 'video', 'file'].includes(existing.qrType)
  ) {
    updates.payload = req.body.payload.trim().slice(0, 4000);
  }
  if (req.body?.expiration) {
    const preset = parseExpirationPreset(req.body.expiration);
    updates.expirationPreset = preset;
    updates.expiresAt = resolveExpirationMs(preset, req.body?.customExpiresAt);
  }
  if (req.body?.design) {
    const d = parseDesign(req.body.design);
    if (d) updates.design = d;
  }

  const updated = await updateQrRecord(shareId, updates);
  if (!updated) {
    res.status(404).json({ error: 'QR code not found.' });
    return;
  }

  res.json({ ok: true, record: toPublicRecord(updated) });
});

router.delete('/:shareId', requireAuth, async (req: AuthRequest, res: Response) => {
  const { shareId } = req.params;
  if (!isValidShareId(shareId)) {
    res.status(404).json({ error: 'QR code not found.' });
    return;
  }

  const existing = getQrRecord(shareId);
  if (!existing) {
    res.status(404).json({ error: 'QR code not found.' });
    return;
  }

  const admin = await isAdminUser(req.user);
  if (existing.ownerUid !== req.user!.uid && !admin) {
    res.status(403).json({ error: 'You do not have permission to delete this QR code.' });
    return;
  }

  await deleteQrRecord(shareId);
  try {
    await adminDb.collection('qr_codes').doc(shareId).delete();
  } catch {
    // Firestore doc cleanup best-effort
  }

  res.json({ ok: true });
});

// 6. Export print-ready PDF using existing mobile-safe /api/download/:secureToken flow
router.post(
  '/pdf',
  optionalAuth,
  express.json({ limit: '6mb' }),
  async (req: AuthRequest, res: Response) => {
    try {
      const title = String(req.body?.title || 'RIKZEN QR Code').trim().slice(0, 120);
      const subtitle = String(req.body?.subtitle || '').trim().slice(0, 200);
      const payload = String(req.body?.payload || '').trim();
      const pngDataUrl = typeof req.body?.pngDataUrl === 'string' ? req.body.pngDataUrl : '';

      let pngBuffer: Buffer;
      if (pngDataUrl.startsWith('data:image/png;base64,')) {
        pngBuffer = Buffer.from(pngDataUrl.slice('data:image/png;base64,'.length), 'base64');
      } else if (payload) {
        pngBuffer = await QRCode.toBuffer(payload, { width: 900, margin: 2 });
      } else {
        res.status(400).json({ error: 'QR image or content is required for PDF export.' });
        return;
      }

      const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
        const doc = new PDFKitDocument({ size: 'A4', margin: 48 });
        const chunks: Buffer[] = [];
        doc.on('data', (c) => chunks.push(Buffer.from(c)));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const pageWidth = doc.page.width;
        const pageHeight = doc.page.height;

        // Subtle brand header
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#B88E1E').text('RIKZEN ALL-IN-ONE TOOLS', 48, 48, {
          align: 'center',
        });
        doc.moveDown(0.6);
        doc.font('Helvetica-Bold').fontSize(22).fillColor('#111214').text(title, {
          align: 'center',
        });

        if (subtitle) {
          doc.moveDown(0.3);
          doc.font('Helvetica').fontSize(11).fillColor('#5A5D65').text(subtitle, {
            align: 'center',
          });
        }

        // Framed QR container centered
        const qrBoxSize = 320;
        const boxX = (pageWidth - qrBoxSize - 32) / 2;
        const boxY = Math.max(165, doc.y + 32);

        doc
          .roundedRect(boxX, boxY, qrBoxSize + 32, qrBoxSize + 32, 20)
          .lineWidth(1.5)
          .strokeColor('#E2DED4')
          .fillAndStroke('#FFFFFF', '#E2DED4');

        doc.image(pngBuffer, boxX + 16, boxY + 16, {
          fit: [qrBoxSize, qrBoxSize],
          align: 'center',
          valign: 'center',
        });

        // Bottom caption
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor('#6B707B')
          .text('Scan with any smartphone camera to open', 48, boxY + qrBoxSize + 56, {
            align: 'center',
          });

        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor('#8E939E')
          .text('Generated with RIKZEN · Everything You Need. One Simple Place.', 48, pageHeight - 56, {
            align: 'center',
          });

        doc.end();
      });

      const baseSlug = sanitizeFilename(title.toLowerCase().replace(/\s+/g, '-')).replace(/\.[^.]+$/, '') || 'rikzen-qr';
      const saved = await saveTempFile({
        buffer: pdfBuffer,
        fileName: `${baseSlug}.pdf`,
        mimeType: 'application/pdf',
        originalSizeBytes: pngBuffer.length,
        ownerUid: req.user?.uid || null,
        toolId: 'qr-generator',
        category: 'utility',
      });

      const urls = getDownloadUrls(saved);
      res.json({
        ok: true,
        fileId: saved.id,
        fileName: saved.fileName,
        mimeType: saved.mimeType,
        sizeBytes: saved.sizeBytes,
        expiresAt: saved.expiresAt,
        secureToken: urls.secureToken,
        downloadUrl: urls.downloadUrl,
        previewUrl: urls.previewUrl,
      });
    } catch (err) {
      console.error('QR PDF export error:', err);
      res.status(500).json({ error: 'Could not build printable QR PDF.' });
    }
  }
);

export default router;
