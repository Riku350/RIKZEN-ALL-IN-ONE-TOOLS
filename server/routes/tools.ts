import { Router, Request, Response, NextFunction } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import multer from 'multer';
import sharp, { type FitEnum, type OverlayOptions, type Sharp } from 'sharp';
import { PDFDocument as PDFLibDocument, degrees } from 'pdf-lib';
import PDFKitDocument from 'pdfkit';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import QRCode from 'qrcode';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { AuthRequest, adminDb, optionalAuth } from '../firebaseAdmin.ts';
import {
  getTempFile,
  parseAndVerifySecureToken,
  sanitizeFilename,
  saveTempFile,
  validateMagicBytes,
  verifyDownloadToken,
} from '../tempStorage.ts';
import {
  ImageFetchError,
  UnsafeUrlError,
  safeFetchExternalImage,
} from '../urlSecurity.ts';

const execFileAsync = promisify(execFile);

const MAX_MB = Math.min(200, Math.max(1, Number(process.env.MAX_FILE_SIZE_MB || process.env.MAX_UPLOAD_MB || '100')));
const MAX_BYTES = MAX_MB * 1024 * 1024;
const MAX_FILES_PER_BATCH = Math.min(200, Math.max(1, Number(process.env.MAX_FILES_PER_BATCH || '50')));
const MAX_TOTAL_BATCH_SIZE_MB = Math.min(2000, Math.max(10, Number(process.env.MAX_TOTAL_BATCH_SIZE_MB || '1000')));
const MAX_TOTAL_BATCH_BYTES = MAX_TOTAL_BATCH_SIZE_MB * 1024 * 1024;
const MAX_PROCESSING_TIME_MS = Math.min(300000, Math.max(10000, Number(process.env.MAX_PROCESSING_TIME_MS || '120000')));
const MAX_CONCURRENT_JOBS = Math.min(8, Math.max(1, Number(process.env.MAX_CONCURRENT_JOBS || '4')));

export function getProcessingLimits() {
  return {
    maxFileSizeMb: MAX_MB,
    maxFilesPerBatch: MAX_FILES_PER_BATCH,
    maxTotalBatchSizeMb: MAX_TOTAL_BATCH_SIZE_MB,
    maxProcessingTimeMs: MAX_PROCESSING_TIME_MS,
    maxConcurrentJobs: MAX_CONCURRENT_JOBS,
  };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_BYTES,
    files: MAX_FILES_PER_BATCH,
  },
});

const router = Router();

let cachedQpdfAvailable: boolean | null = null;
export async function checkQpdfAvailable(): Promise<boolean> {
  if (cachedQpdfAvailable !== null) return cachedQpdfAvailable;
  try {
    await execFileAsync('qpdf', ['--version'], { timeout: 2000 });
    cachedQpdfAvailable = true;
  } catch {
    cachedQpdfAvailable = false;
  }
  return cachedQpdfAvailable;
}

async function isToolEnabled(toolId: string): Promise<{ enabled: boolean; maxMb: number }> {
  try {
    const snap = await adminDb.collection('tool_configs').doc(toolId).get();
    if (snap.exists) {
      const data = snap.data();
      return {
        enabled: data?.enabled !== false,
        maxMb: typeof data?.maxFileSizeMb === 'number' ? data.maxFileSizeMb : MAX_MB,
      };
    }
  } catch {
    // Default enabled
  }
  return { enabled: true, maxMb: MAX_MB };
}

async function recordUserOperation(params: {
  uid: string | null;
  toolId: string;
  toolName: string;
  category: string;
  fileName: string;
  inputSizeBytes: number;
  outputSizeBytes: number;
  status: 'completed' | 'failed';
  fileRecord?: {
    id: string;
    mimeType: string;
    expiresAtMs: number;
  };
}) {
  try {
    const batch = adminDb.batch();
    const now = FieldValue.serverTimestamp();

    const statRef = adminDb.collection('analytics_events').doc();
    batch.set(statRef, {
      event: params.status === 'completed' ? 'processing_completed' : 'processing_failed',
      toolId: params.toolId,
      category: params.category,
      inputSizeBytes: params.inputSizeBytes,
      outputSizeBytes: params.outputSizeBytes,
      createdAt: now,
    });

    if (params.uid) {
      const historyId = crypto.randomUUID().replace(/-/g, '');
      const histRef = adminDb.collection('tool_history').doc(historyId);
      batch.set(histRef, {
        id: historyId,
        userId: params.uid,
        toolId: params.toolId,
        toolName: params.toolName,
        category: params.category,
        fileName: params.fileName.slice(0, 250),
        inputSizeBytes: params.inputSizeBytes,
        outputSizeBytes: params.outputSizeBytes,
        status: params.status,
        createdAt: now,
      });

      if (params.status === 'completed' && params.fileRecord) {
        const fileDocId = params.fileRecord.id;
        const fileRef = adminDb.collection('files').doc(fileDocId);
        batch.set(fileRef, {
          id: fileDocId,
          userId: params.uid,
          fileName: params.fileName.slice(0, 250),
          mimeType: params.fileRecord.mimeType,
          sizeBytes: params.outputSizeBytes,
          originalSizeBytes: params.inputSizeBytes,
          toolId: params.toolId,
          category: params.category,
          serverFileId: params.fileRecord.id,
          expiresAt: Timestamp.fromMillis(params.fileRecord.expiresAtMs),
          createdAt: now,
        });
      }
    }

    await batch.commit();
  } catch (err) {
    console.error('Failed to record tool operation:', err);
  }
}

function handleMulterError(err: unknown, _req: Request, res: Response, next: NextFunction) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        code: 'FILE_TOO_LARGE',
        error: `A file exceeds the ${MAX_MB} MB per-file limit.`,
      });
      return;
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      res.status(413).json({
        code: 'TOO_MANY_FILES',
        error: `Too many files selected. Maximum ${MAX_FILES_PER_BATCH} files per batch.`,
      });
      return;
    }
    res.status(400).json({
      code: 'UPLOAD_ERROR',
      error: 'Could not read the uploaded file. Please try again.',
    });
    return;
  }
  next(err);
}

function validateTotalBatchBytes(files: Express.Multer.File[]): { ok: true; totalBytes: number } | { ok: false; error: string } {
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > MAX_TOTAL_BATCH_BYTES) {
    return {
      ok: false,
      error: `Total batch size (${(totalBytes / (1024 * 1024)).toFixed(1)} MB) exceeds the ${MAX_TOTAL_BATCH_SIZE_MB} MB batch limit.`,
    };
  }
  return { ok: true, totalBytes };
}

function renderPdfBufferFromLines(title: string, sections: { heading?: string; lines: string[] }[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFKitDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (title) {
      doc.fontSize(18).font('Helvetica-Bold').fillColor('#111214').text(title, { align: 'left' });
      doc.moveDown(0.75);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#D4AF37').lineWidth(1).stroke();
      doc.moveDown(0.75);
    }

    sections.forEach((section, index) => {
      if (index > 0 && section.heading) {
        doc.addPage();
      }
      if (section.heading) {
        doc.fontSize(14).font('Helvetica-Bold').fillColor('#111214').text(section.heading);
        doc.moveDown(0.5);
      }
      doc.fontSize(10.5).font('Helvetica').fillColor('#222428');
      for (const line of section.lines) {
        doc.text(line, { lineGap: 4 });
      }
    });

    doc.end();
  });
}

// 0. SAFE EXTERNAL IMAGE URL FETCH (SSRF-protected)
router.post(
  '/image/fetch-url',
  optionalAuth,
  async (req: AuthRequest, res: Response) => {
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!rawUrl) {
      res.status(400).json({ error: 'Please paste an image URL first.' });
      return;
    }

    try {
      const fetched = await safeFetchExternalImage(rawUrl, MAX_BYTES);
      const stored = await saveTempFile({
        buffer: fetched.buffer,
        fileName: fetched.fileName,
        mimeType: fetched.mimeType,
        originalSizeBytes: fetched.sizeBytes,
        ownerUid: req.user?.uid || null,
        toolId: 'image-url-fetch',
        category: 'image',
      });

      res.json({
        ok: true,
        fileId: stored.id,
        fileName: stored.fileName,
        mimeType: fetched.mimeType,
        format: fetched.format,
        width: fetched.width,
        height: fetched.height,
        sizeBytes: fetched.sizeBytes,
        originalUrl: rawUrl,
        finalUrl: fetched.finalUrl,
        downloadUrl: `/api/download/${encodeURIComponent(stored.secureToken)}`,
        previewUrl: `/api/download/${encodeURIComponent(stored.secureToken)}?inline=1`,
        expiresAt: stored.expiresAt,
      });
    } catch (err) {
      if (err instanceof UnsafeUrlError) {
        res.status(err.status).json({ code: 'UNSAFE_URL', error: err.message });
        return;
      }
      if (err instanceof ImageFetchError) {
        res.status(err.status).json({ code: 'FETCH_FAILED', error: err.message });
        return;
      }
      res.status(422).json({
        code: 'FETCH_FAILED',
        error: "Couldn't load this image. Try another URL.",
      });
    }
  }
);

// 1. IMAGE PROCESSING TOOLS
router.post(
  '/image/process',
  optionalAuth,
  upload.single('file'),
  handleMulterError,
  async (req: AuthRequest, res: Response) => {
    const file = req.file;
    const toolId = String(req.body?.toolId || 'compress-image');
    const toolName = String(req.body?.toolName || 'Image Tool');

    const cfg = await isToolEnabled(toolId);
    if (!cfg.enabled) {
      res.status(503).json({ error: 'This tool is temporarily disabled by the administrator.' });
      return;
    }

    if (!file) {
      res.status(400).json({ error: 'Please choose an image file first.' });
      return;
    }

    if (!validateMagicBytes(file.buffer, ['image'])) {
      res.status(415).json({
        code: 'UNSUPPORTED_FILE',
        error: "This file type isn't supported. Please upload a valid JPG, PNG, WebP, TIFF, GIF, or AVIF image.",
      });
      return;
    }

    try {
      const quality = Math.min(100, Math.max(10, Number(req.body?.quality || 78)));
      const requestedFormat = String(req.body?.format || 'auto').toLowerCase();
      const width = req.body?.width ? Math.min(10000, Math.max(1, Number(req.body.width))) : undefined;
      const height = req.body?.height ? Math.min(10000, Math.max(1, Number(req.body.height))) : undefined;
      const fitRaw = String(req.body?.fit || 'inside');
      const fit: keyof FitEnum =
        fitRaw === 'cover' || fitRaw === 'contain' || fitRaw === 'fill' || fitRaw === 'inside' || fitRaw === 'outside'
          ? fitRaw
          : 'inside';
      const passportPreset = String(req.body?.passportPreset || '35x45');
      const passportBg = String(req.body?.passportBg || '#ffffff');

      const cropLeft = Number(req.body?.cropLeft);
      const cropTop = Number(req.body?.cropTop);
      const cropWidth = Number(req.body?.cropWidth);
      const cropHeight = Number(req.body?.cropHeight);

      let pipeline = sharp(file.buffer, { failOn: 'none' }).rotate();
      const meta = await pipeline.metadata();

      if (toolId === 'crop-image' && Number.isFinite(cropWidth) && Number.isFinite(cropHeight) && cropWidth > 0 && cropHeight > 0) {
        const imgW = meta.width || 1000;
        const imgH = meta.height || 1000;
        const safeLeft = Math.max(0, Math.min(imgW - 1, Math.round(cropLeft || 0)));
        const safeTop = Math.max(0, Math.min(imgH - 1, Math.round(cropTop || 0)));
        const safeW = Math.max(1, Math.min(imgW - safeLeft, Math.round(cropWidth)));
        const safeH = Math.max(1, Math.min(imgH - safeTop, Math.round(cropHeight)));
        pipeline = pipeline.extract({ left: safeLeft, top: safeTop, width: safeW, height: safeH });
      } else if (toolId === 'passport-photo') {
        const presets: Record<string, { w: number; h: number }> = {
          '35x45': { w: 413, h: 531 }, // 35x45mm @ 300 DPI
          '2x2': { w: 600, h: 600 },   // 2x2 inch @ 300 DPI (US/India)
          '35x35': { w: 413, h: 413 }, // 35x35mm @ 300 DPI
        };
        const dim = presets[passportPreset] || presets['35x45'];
        pipeline = pipeline
          .flatten({ background: passportBg })
          .resize(dim.w, dim.h, { fit: 'cover', position: 'attention' });
      } else if (width || height) {
        pipeline = pipeline.resize(width || null, height || null, {
          fit,
          withoutEnlargement: req.body?.allowUpscale === 'true' ? false : true,
        });
      }

      if (toolId === 'image-quality-optimizer') {
        pipeline = pipeline.sharpen({ sigma: 0.7 });
      }

      // Preserve metadata unless explicitly removing metadata or compressing aggressively
      if (toolId !== 'image-metadata-removal' && toolId !== 'compress-image') {
        pipeline = pipeline.withMetadata();
      }

      let targetFmt: 'jpeg' | 'png' | 'webp' | 'avif' | 'tiff' = 'jpeg';
      if (requestedFormat === 'auto') {
        if (toolId === 'jpg-to-png') targetFmt = 'png';
        else if (toolId === 'png-to-jpg' || toolId === 'webp-to-jpg' || toolId === 'passport-photo') targetFmt = 'jpeg';
        else if (toolId === 'jpg-to-webp') targetFmt = 'webp';
        else if (meta.format === 'png') targetFmt = 'png';
        else if (meta.format === 'webp') targetFmt = 'webp';
        else targetFmt = 'jpeg';
      } else if (requestedFormat === 'jpg' || requestedFormat === 'jpeg') {
        targetFmt = 'jpeg';
      } else if (requestedFormat === 'png') {
        targetFmt = 'png';
      } else if (requestedFormat === 'webp') {
        targetFmt = 'webp';
      } else if (requestedFormat === 'avif') {
        targetFmt = 'avif';
      } else if (requestedFormat === 'tiff') {
        targetFmt = 'tiff';
      }

      if (targetFmt === 'jpeg') {
        pipeline = pipeline
          .flatten({ background: '#ffffff' })
          .jpeg({ quality, mozjpeg: true, progressive: true });
      } else if (targetFmt === 'png') {
        const compressionLevel = Math.min(9, Math.max(1, Math.round((100 - quality) / 11) + 2));
        pipeline = pipeline.png({
          compressionLevel,
          palette: toolId === 'compress-image' || toolId === 'image-quality-optimizer',
          quality,
        });
      } else if (targetFmt === 'webp') {
        pipeline = pipeline.webp({ quality, effort: 4 });
      } else if (targetFmt === 'avif') {
        pipeline = pipeline.avif({ quality, effort: 4 });
      } else if (targetFmt === 'tiff') {
        pipeline = pipeline.tiff({ quality });
      }

      const { data: outBuffer, info } = await pipeline.toBuffer({ resolveWithObject: true });

      const baseName = pathBaseWithoutExt(file.originalname);
      const ext = targetFmt === 'jpeg' ? 'jpg' : targetFmt;
      const outFileName = sanitizeFilename(`${baseName}-${toolId.replace(/-image$/, '')}.${ext}`);
      const mimeMap: Record<string, string> = {
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        avif: 'image/avif',
        tiff: 'image/tiff',
      };
      const mimeType = mimeMap[targetFmt] || 'application/octet-stream';

      const stored = await saveTempFile({
        buffer: outBuffer,
        fileName: outFileName,
        mimeType,
        originalSizeBytes: file.size,
        ownerUid: req.user?.uid || null,
        toolId,
        category: 'image',
      });

      await recordUserOperation({
        uid: req.user?.uid || null,
        toolId,
        toolName,
        category: 'image',
        fileName: outFileName,
        inputSizeBytes: file.size,
        outputSizeBytes: outBuffer.length,
        status: 'completed',
        fileRecord: { id: stored.id, mimeType, expiresAtMs: stored.expiresAt },
      });

      res.json({
        fileId: stored.id,
        fileName: stored.fileName,
        mimeType: stored.mimeType,
        originalSizeBytes: file.size,
        outputSizeBytes: outBuffer.length,
        width: info.width,
        height: info.height,
        downloadUrl: `/api/download/${encodeURIComponent(stored.secureToken)}`,
        previewUrl: `/api/download/${encodeURIComponent(stored.secureToken)}?inline=1`,
        expiresAt: stored.expiresAt,
      });
    } catch (err) {
      console.error('Image processing error:', err);
      await recordUserOperation({
        uid: req.user?.uid || null,
        toolId,
        toolName,
        category: 'image',
        fileName: file.originalname,
        inputSizeBytes: file.size,
        outputSizeBytes: 0,
        status: 'failed',
      });
      res.status(500).json({ error: 'Could not process this image. Please try another file.' });
    }
  }
);

// 2. BACKGROUND REMOVAL (Real Remove.bg API integration; honest 503 if unconfigured)
router.post(
  '/image/remove-bg',
  optionalAuth,
  upload.single('file'),
  handleMulterError,
  async (req: AuthRequest, res: Response) => {
    const apiKey = process.env.REMOVEBG_API_KEY;
    if (!apiKey) {
      res.status(503).json({
        code: 'BACKEND_NOT_CONFIGURED',
        error:
          'Background removal requires REMOVEBG_API_KEY to be configured on the server. No simulated cutout was performed.',
      });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Please select an image first.' });
      return;
    }
    if (!validateMagicBytes(file.buffer, ['image'])) {
      res.status(415).json({ error: "This file type isn't supported." });
      return;
    }

    try {
      const form = new FormData();
      form.append('image_file', new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }), file.originalname);
      form.append('size', 'auto');

      const upstream = await fetch('https://api.remove.bg/v1.0/removebg', {
        method: 'POST',
        headers: { 'X-Api-Key': apiKey },
        body: form,
      });

      if (!upstream.ok) {
        const msg = await upstream.text();
        console.error('Remove.bg upstream error:', upstream.status, msg);
        res.status(502).json({ error: 'Background removal service returned an error. Please try again.' });
        return;
      }

      const arrayBuf = await upstream.arrayBuffer();
      const outBuffer = Buffer.from(arrayBuf);
      const outName = sanitizeFilename(`${pathBaseWithoutExt(file.originalname)}-no-bg.png`);

      const stored = await saveTempFile({
        buffer: outBuffer,
        fileName: outName,
        mimeType: 'image/png',
        originalSizeBytes: file.size,
        ownerUid: req.user?.uid || null,
        toolId: 'background-removal',
        category: 'image',
      });

      await recordUserOperation({
        uid: req.user?.uid || null,
        toolId: 'background-removal',
        toolName: 'Background Removal',
        category: 'image',
        fileName: outName,
        inputSizeBytes: file.size,
        outputSizeBytes: outBuffer.length,
        status: 'completed',
        fileRecord: { id: stored.id, mimeType: 'image/png', expiresAtMs: stored.expiresAt },
      });

      res.json({
        fileId: stored.id,
        fileName: stored.fileName,
        mimeType: stored.mimeType,
        originalSizeBytes: file.size,
        outputSizeBytes: outBuffer.length,
        downloadUrl: `/api/download/${encodeURIComponent(stored.secureToken)}`,
        previewUrl: `/api/download/${encodeURIComponent(stored.secureToken)}?inline=1`,
        expiresAt: stored.expiresAt,
      });
    } catch (err) {
      console.error('Remove.bg error:', err);
      res.status(500).json({ error: 'Background removal failed. Please try again.' });
    }
  }
);

// 2B. BACKGROUND COMPOSITOR (Live preview & high-res server export for transparent cutouts)
router.post(
  '/image/composite-bg',
  optionalAuth,
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'bgImage', maxCount: 1 },
  ]),
  handleMulterError,
  async (req: AuthRequest, res: Response) => {
    const fileMap = req.files as Record<string, Express.Multer.File[]> | undefined;
    const fgFile = fileMap?.file?.[0];
    const bgFile = fileMap?.bgImage?.[0];

    if (!fgFile || !validateMagicBytes(fgFile.buffer, ['image'])) {
      res.status(415).json({ error: 'Please upload a valid foreground image.' });
      return;
    }
    if (bgFile && !validateMagicBytes(bgFile.buffer, ['image'])) {
      res.status(415).json({ error: 'The custom background file is not a valid image.' });
      return;
    }

    try {
      const bgType = String(req.body?.bgType || 'transparent'); // 'transparent' | 'color' | 'image'
      const bgColor = String(req.body?.bgColor || '#ffffff');
      const bgBlur = Math.min(40, Math.max(0, Number(req.body?.bgBlur || 0)));
      const bgOpacity = Math.min(100, Math.max(0, Number(req.body?.bgOpacity ?? 100))) / 100;
      const fitMode = String(req.body?.fit || 'contain') === 'cover' ? 'cover' : 'contain';
      const scale = Math.min(2, Math.max(0.3, Number(req.body?.scale || 1)));
      const posX = Math.min(100, Math.max(-100, Number(req.body?.posX || 0)));
      const posY = Math.min(100, Math.max(-100, Number(req.body?.posY || 0)));
      const outputFormat = String(req.body?.outputFormat || 'png').toLowerCase() === 'jpg' ? 'jpeg' : 'png';
      const quality = Math.min(98, Math.max(20, Number(req.body?.quality || 90)));

      const fgMeta = await sharp(fgFile.buffer, { failOn: 'none' }).rotate().metadata();
      const canvasW = Math.min(4000, fgMeta.width || 1200);
      const canvasH = Math.min(4000, fgMeta.height || 1200);

      // Prepare foreground scaled to fit canvas * scale
      const scaledW = Math.max(32, Math.round(canvasW * scale));
      const scaledH = Math.max(32, Math.round(canvasH * scale));
      const fgRendered = await sharp(fgFile.buffer, { failOn: 'none' })
        .rotate()
        .ensureAlpha()
        .resize(scaledW, scaledH, { fit: fitMode, background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .toBuffer({ resolveWithObject: true });

      // Position foreground within canvas (crop if larger than canvas, offset if smaller or shifted)
      const centerLeft = Math.round((canvasW - fgRendered.info.width) / 2 + (posX / 100) * (canvasW * 0.4));
      const centerTop = Math.round((canvasH - fgRendered.info.height) / 2 + (posY / 100) * (canvasH * 0.4));

      // Clip foreground safely onto canvasW x canvasH transparent plate
      const srcExtractLeft = Math.max(0, -centerLeft);
      const srcExtractTop = Math.max(0, -centerTop);
      const dstLeft = Math.max(0, centerLeft);
      const dstTop = Math.max(0, centerTop);
      const copyW = Math.min(fgRendered.info.width - srcExtractLeft, canvasW - dstLeft);
      const copyH = Math.min(fgRendered.info.height - srcExtractTop, canvasH - dstTop);

      let fgLayer = fgRendered.data;
      if (copyW > 0 && copyH > 0 && (srcExtractLeft > 0 || srcExtractTop > 0 || fgRendered.info.width > copyW || fgRendered.info.height > copyH)) {
        fgLayer = await sharp(fgRendered.data)
          .extract({ left: srcExtractLeft, top: srcExtractTop, width: copyW, height: copyH })
          .toBuffer();
      }

      let baseCanvas: Sharp;
      if (bgType === 'image' && bgFile) {
        let bgPipe = sharp(bgFile.buffer, { failOn: 'none' })
          .rotate()
          .resize(canvasW, canvasH, { fit: 'cover' })
          .ensureAlpha();
        if (bgBlur >= 0.5) {
          bgPipe = bgPipe.blur(Math.max(0.3, bgBlur));
        }
        const bgBuf = await bgPipe.toBuffer();
        if (bgOpacity < 0.99) {
          // Composite semi-opaque bg over white/transparent base
          const bgWithOpacity = await sharp(bgBuf)
            .composite([
              {
                input: Buffer.from(
                  `<svg width="${canvasW}" height="${canvasH}"><rect width="100%" height="100%" fill="white" fill-opacity="${1 - bgOpacity}"/></svg>`
                ),
                blend: 'dest-out',
              },
            ])
            .toBuffer();
          baseCanvas = sharp({
            create: {
              width: canvasW,
              height: canvasH,
              channels: 4,
              background: outputFormat === 'jpeg' ? { r: 255, g: 255, b: 255, alpha: 1 } : { r: 0, g: 0, b: 0, alpha: 0 },
            },
          }).composite([{ input: bgWithOpacity }]);
        } else {
          baseCanvas = sharp(bgBuf);
        }
      } else if (bgType === 'color') {
        const parsedHex = /^#?([0-9a-f]{6})$/i.exec(bgColor.trim());
        const hex = parsedHex ? parsedHex[1] : 'ffffff';
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        baseCanvas = sharp({
          create: {
            width: canvasW,
            height: canvasH,
            channels: 4,
            background: { r, g, b, alpha: outputFormat === 'jpeg' ? 1 : bgOpacity },
          },
        });
      } else {
        baseCanvas = sharp({
          create: {
            width: canvasW,
            height: canvasH,
            channels: 4,
            background:
              outputFormat === 'jpeg'
                ? { r: 255, g: 255, b: 255, alpha: 1 }
                : { r: 0, g: 0, b: 0, alpha: 0 },
          },
        });
      }

      if (copyW > 0 && copyH > 0) {
        baseCanvas = baseCanvas.composite([{ input: fgLayer, left: dstLeft, top: dstTop }]);
      }

      const outPipe =
        outputFormat === 'jpeg'
          ? baseCanvas.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true })
          : baseCanvas.png({ compressionLevel: 7 });

      const { data: outBuffer, info } = await outPipe.toBuffer({ resolveWithObject: true });
      const ext = outputFormat === 'jpeg' ? 'jpg' : 'png';
      const mimeType = outputFormat === 'jpeg' ? 'image/jpeg' : 'image/png';
      const outName = sanitizeFilename(`${pathBaseWithoutExt(fgFile.originalname)}-rikzen-bg.${ext}`);

      const stored = await saveTempFile({
        buffer: outBuffer,
        fileName: outName,
        mimeType,
        originalSizeBytes: fgFile.size,
        ownerUid: req.user?.uid || null,
        toolId: 'background-removal',
        category: 'image',
      });

      await recordUserOperation({
        uid: req.user?.uid || null,
        toolId: 'background-removal',
        toolName: 'Background Studio',
        category: 'image',
        fileName: outName,
        inputSizeBytes: fgFile.size,
        outputSizeBytes: outBuffer.length,
        status: 'completed',
        fileRecord: { id: stored.id, mimeType, expiresAtMs: stored.expiresAt },
      });

      res.json({
        fileId: stored.id,
        fileName: stored.fileName,
        mimeType,
        originalSizeBytes: fgFile.size,
        outputSizeBytes: outBuffer.length,
        width: info.width,
        height: info.height,
        downloadUrl: `/api/download/${encodeURIComponent(stored.secureToken)}`,
        previewUrl: `/api/download/${encodeURIComponent(stored.secureToken)}?inline=1`,
        expiresAt: stored.expiresAt,
      });
    } catch (err) {
      console.error('Composite BG error:', err);
      res.status(500).json({ error: 'Could not compose image background. Please try another image.' });
    }
  }
);

// 2C. PASSPORT PHOTO STUDIO + PRINTABLE A4 SHEET (JPG + PDF)
router.post(
  '/image/passport-sheet',
  optionalAuth,
  upload.single('file'),
  handleMulterError,
  async (req: AuthRequest, res: Response) => {
    const file = req.file;
    if (!file || !validateMagicBytes(file.buffer, ['image'])) {
      res.status(415).json({ error: 'Please upload a valid portrait photo (JPG, PNG, or WebP).' });
      return;
    }

    try {
      const preset = String(req.body?.preset || '35x45');
      const customW = Math.min(120, Math.max(15, Number(req.body?.customWidthMm || 35)));
      const customH = Math.min(150, Math.max(15, Number(req.body?.customHeightMm || 45)));

      const dimsMm: Record<string, { w: number; h: number }> = {
        '35x45': { w: 35, h: 45 },
        '2x2': { w: 50.8, h: 50.8 },
        '35x35': { w: 35, h: 35 },
        custom: { w: customW, h: customH },
      };
      const chosenMm = dimsMm[preset] || dimsMm['35x45'];
      const pxPerMm = 300 / 25.4; // 11.811 px/mm @ 300 DPI
      const targetW = Math.round(chosenMm.w * pxPerMm);
      const targetH = Math.round(chosenMm.h * pxPerMm);

      const bgColor = /^#[0-9a-f]{6}$/i.test(String(req.body?.bgColor || '').trim())
        ? String(req.body.bgColor).trim()
        : '#ffffff';
      const zoom = Math.min(2.5, Math.max(0.6, Number(req.body?.zoom || 1)));
      const offsetX = Math.min(100, Math.max(-100, Number(req.body?.offsetX || 0)));
      const offsetY = Math.min(100, Math.max(-100, Number(req.body?.offsetY || 0)));
      const rotation = Math.min(180, Math.max(-180, Number(req.body?.rotation || 0)));
      const brightness = Math.min(1.6, Math.max(0.5, Number(req.body?.brightness || 1)));
      const contrast = Math.min(1.6, Math.max(0.5, Number(req.body?.contrast || 1)));
      const autoRemoveBg = String(req.body?.autoRemoveBg || 'false') === 'true';

      let workingBuffer = file.buffer;
      let bgRemoved = false;
      const removeBgKey = process.env.REMOVEBG_API_KEY;
      if (autoRemoveBg && removeBgKey) {
        try {
          const rmForm = new FormData();
          rmForm.append('image_file', new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }), file.originalname);
          rmForm.append('size', 'auto');
          const upstream = await fetch('https://api.remove.bg/v1.0/removebg', {
            method: 'POST',
            headers: { 'X-Api-Key': removeBgKey },
            body: rmForm,
          });
          if (upstream.ok) {
            workingBuffer = Buffer.from(await upstream.arrayBuffer());
            bgRemoved = true;
          }
        } catch {
          // Fall back gracefully without failing sheet generation
        }
      }

      // Normalize orientation, apply user rotation + brightness/contrast
      let prepPipe = sharp(workingBuffer, { failOn: 'none' }).rotate();
      if (Math.abs(rotation) > 0.1) {
        prepPipe = prepPipe.rotate(rotation, { background: bgColor });
      }
      if (Math.abs(brightness - 1) > 0.01) {
        prepPipe = prepPipe.modulate({ brightness });
      }
      if (Math.abs(contrast - 1) > 0.01) {
        // linear(a, b) contrast around midpoint 128
        prepPipe = prepPipe.linear(contrast, -(128 * contrast) + 128);
      }

      const preppedBuf = await prepPipe.ensureAlpha().toBuffer();
      const preppedMeta = await sharp(preppedBuf).metadata();
      const srcW = preppedMeta.width || targetW;
      const srcH = preppedMeta.height || targetH;

      // Compute crop rectangle covering targetW:targetH scaled by 1/zoom and panned by offsetX/offsetY
      const targetAspect = targetW / targetH;
      const srcAspect = srcW / srcH;
      let baseCropW = srcAspect > targetAspect ? srcH * targetAspect : srcW;
      let baseCropH = srcAspect > targetAspect ? srcH : srcW / targetAspect;

      const cropW = Math.max(20, Math.min(srcW, Math.round(baseCropW / zoom)));
      const cropH = Math.max(20, Math.min(srcH, Math.round(baseCropH / zoom)));

      const maxShiftX = Math.max(0, (srcW - cropW) / 2);
      const maxShiftY = Math.max(0, (srcH - cropH) / 2);
      const cropLeft = Math.max(0, Math.min(srcW - cropW, Math.round((srcW - cropW) / 2 - (offsetX / 100) * maxShiftX)));
      const cropTop = Math.max(0, Math.min(srcH - cropH, Math.round((srcH - cropH) / 2 - (offsetY / 100) * maxShiftY)));

      const singleBuffer = await sharp(preppedBuf)
        .extract({ left: cropLeft, top: cropTop, width: cropW, height: cropH })
        .resize(targetW, targetH, { fit: 'cover' })
        .flatten({ background: bgColor })
        .jpeg({ quality: 95, mozjpeg: true })
        .toBuffer();

      // Build A4 Printable Sheet (210 x 297 mm @ 300 DPI = 2480 x 3508 px)
      const a4W = 2480;
      const a4H = 3508;
      const pageMarginPx = Math.round(12 * pxPerMm); // 12mm margin
      const gapPx = Math.round(4 * pxPerMm); // 4mm gap

      const cols = Math.max(1, Math.floor((a4W - pageMarginPx * 2 + gapPx) / (targetW + gapPx)));
      const rows = Math.max(1, Math.floor((a4H - pageMarginPx * 2 + gapPx) / (targetH + gapPx)));
      const requestedCopies = Number(req.body?.copies || 0);
      const maxCopies = requestedCopies > 0 ? Math.min(cols * rows, requestedCopies) : cols * rows;

      const gridW = cols * targetW + (cols - 1) * gapPx;
      const gridH = rows * targetH + (rows - 1) * gapPx;
      const startX = Math.round((a4W - gridW) / 2);
      const startY = Math.round((a4H - gridH) / 2);

      // Subtle 1px light slate cut border around each photo
      const borderedPhoto = await sharp(singleBuffer)
        .extend({ top: 1, bottom: 1, left: 1, right: 1, background: '#cbd5e1' })
        .toBuffer();

      const composites: OverlayOptions[] = [];
      for (let i = 0; i < maxCopies; i++) {
        const r = Math.floor(i / cols);
        const c = i % cols;
        composites.push({
          input: borderedPhoto,
          left: startX + c * (targetW + gapPx) - 1,
          top: startY + r * (targetH + gapPx) - 1,
        });
      }

      const sheetJpgBuffer = await sharp({
        create: { width: a4W, height: a4H, channels: 3, background: '#ffffff' },
      })
        .composite(composites)
        .jpeg({ quality: 94, mozjpeg: true })
        .toBuffer();

      // Create exact A4 PDF containing the 300 DPI sheet
      const sheetPdf = await PDFLibDocument.create();
      const embeddedSheet = await sheetPdf.embedJpg(sheetJpgBuffer);
      const a4Page = sheetPdf.addPage([595.28, 841.89]);
      a4Page.drawImage(embeddedSheet, { x: 0, y: 0, width: 595.28, height: 841.89 });
      const sheetPdfBuffer = Buffer.from(await sheetPdf.save({ useObjectStreams: true }));

      const base = pathBaseWithoutExt(file.originalname);
      const singleName = sanitizeFilename(`${base}-passport-single.jpg`);
      const jpgName = sanitizeFilename(`${base}-passport-a4-sheet.jpg`);
      const pdfName = sanitizeFilename(`${base}-passport-a4-sheet.pdf`);

      const [storedSingle, storedJpg, storedPdf] = await Promise.all([
        saveTempFile({
          buffer: singleBuffer,
          fileName: singleName,
          mimeType: 'image/jpeg',
          originalSizeBytes: file.size,
          ownerUid: req.user?.uid || null,
          toolId: 'passport-photo',
          category: 'image',
        }),
        saveTempFile({
          buffer: sheetJpgBuffer,
          fileName: jpgName,
          mimeType: 'image/jpeg',
          originalSizeBytes: file.size,
          ownerUid: req.user?.uid || null,
          toolId: 'passport-photo',
          category: 'image',
        }),
        saveTempFile({
          buffer: sheetPdfBuffer,
          fileName: pdfName,
          mimeType: 'application/pdf',
          originalSizeBytes: file.size,
          ownerUid: req.user?.uid || null,
          toolId: 'passport-photo',
          category: 'image',
        }),
      ]);

      await recordUserOperation({
        uid: req.user?.uid || null,
        toolId: 'passport-photo',
        toolName: 'Passport Photo Sheet',
        category: 'image',
        fileName: jpgName,
        inputSizeBytes: file.size,
        outputSizeBytes: sheetJpgBuffer.length,
        status: 'completed',
        fileRecord: { id: storedJpg.id, mimeType: 'image/jpeg', expiresAtMs: storedJpg.expiresAt },
      });

      res.json({
        singleUrl: `/api/download/${encodeURIComponent(storedSingle.secureToken)}?inline=1`,
        singleDownloadUrl: `/api/download/${encodeURIComponent(storedSingle.secureToken)}`,
        downloadJpgUrl: `/api/download/${encodeURIComponent(storedJpg.secureToken)}`,
        previewJpgUrl: `/api/download/${encodeURIComponent(storedJpg.secureToken)}?inline=1`,
        downloadPdfUrl: `/api/download/${encodeURIComponent(storedPdf.secureToken)}`,
        jpgFileName: jpgName,
        pdfFileName: pdfName,
        originalSizeBytes: file.size,
        jpgSizeBytes: sheetJpgBuffer.length,
        pdfSizeBytes: sheetPdfBuffer.length,
        cols,
        rows,
        totalPhotos: maxCopies,
        photoWidthMm: chosenMm.w,
        photoHeightMm: chosenMm.h,
        bgRemoved,
        expiresAt: storedJpg.expiresAt,
      });
    } catch (err) {
      console.error('Passport sheet error:', err);
      res.status(500).json({ error: 'Could not generate passport photo sheet. Please try another portrait.' });
    }
  }
);

// 3. PDF TOOLS
router.post(
  '/pdf/merge',
  optionalAuth,
  upload.array('files', MAX_FILES_PER_BATCH),
  handleMulterError,
  async (req: AuthRequest, res: Response) => {
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length < 2) {
      res.status(400).json({ error: 'Please select at least 2 PDF files to merge.' });
      return;
    }

    const batchCheck = validateTotalBatchBytes(files);
    if (!batchCheck.ok) {
      res.status(413).json({ code: 'BATCH_TOO_LARGE', error: batchCheck.error });
      return;
    }

    for (const f of files) {
      if (!f.buffer || f.buffer.length === 0) {
        res.status(400).json({
          code: 'PDF_EMPTY',
          failedFile: f.originalname,
          error: `"${f.originalname}" is empty (0 bytes). Please remove or replace it.`,
        });
        return;
      }
      if (!validateMagicBytes(f.buffer, ['pdf'])) {
        res.status(415).json({
          code: 'UNSUPPORTED_FILE',
          failedFile: f.originalname,
          error: `"${f.originalname}" is not a valid PDF file.`,
        });
        return;
      }
    }

    try {
      const merged = await PDFLibDocument.create();

      for (const f of files) {
        try {
          const src = await PDFLibDocument.load(f.buffer, { ignoreEncryption: false });
          const pageCount = src.getPageCount();
          if (pageCount === 0) {
            res.status(400).json({
              code: 'PDF_EMPTY',
              failedFile: f.originalname,
              error: `"${f.originalname}" contains 0 pages.`,
            });
            return;
          }

          const pages = await merged.copyPages(src, src.getPageIndices());
          pages.forEach((p) => merged.addPage(p));
        } catch (fileErr) {
          const msg = fileErr instanceof Error ? fileErr.message.toLowerCase() : '';
          if (msg.includes('encrypt') || msg.includes('password')) {
            res.status(422).json({
              code: 'PDF_ENCRYPTED',
              failedFile: f.originalname,
              error: `"${f.originalname}" is password-protected. Unlock it first or remove it from the list.`,
            });
            return;
          }
          res.status(400).json({
            code: 'PDF_CORRUPTED',
            failedFile: f.originalname,
            error: `"${f.originalname}" is corrupted or uses an unsupported PDF structure.`,
          });
          return;
        }
      }

      if (merged.getPageCount() === 0) {
        res.status(400).json({ error: 'No pages could be merged from the selected PDFs.' });
        return;
      }

      merged.setProducer('RIKZEN PDF Merger');
      merged.setCreator('RIKZEN');
      const outBytes = await merged.save({ useObjectStreams: true });
      const outBuffer = Buffer.from(outBytes);
      const outName = sanitizeFilename('rikzen-merged.pdf');

      const stored = await saveTempFile({
        buffer: outBuffer,
        fileName: outName,
        mimeType: 'application/pdf',
        originalSizeBytes: batchCheck.totalBytes,
        ownerUid: req.user?.uid || null,
        toolId: 'merge-pdf',
        category: 'pdf',
      });

      await recordUserOperation({
        uid: req.user?.uid || null,
        toolId: 'merge-pdf',
        toolName: 'Merge PDF',
        category: 'pdf',
        fileName: outName,
        inputSizeBytes: batchCheck.totalBytes,
        outputSizeBytes: outBuffer.length,
        status: 'completed',
        fileRecord: { id: stored.id, mimeType: 'application/pdf', expiresAtMs: stored.expiresAt },
      });

      res.json({
        fileId: stored.id,
        fileName: stored.fileName,
        mimeType: 'application/pdf',
        originalSizeBytes: batchCheck.totalBytes,
        outputSizeBytes: outBuffer.length,
        pageCount: merged.getPageCount(),
        fileCount: files.length,
        downloadUrl: `/api/download/${encodeURIComponent(stored.secureToken)}`,
        expiresAt: stored.expiresAt,
      });
    } catch (err) {
      console.error('Merge PDF error:', err);
      res.status(500).json({ error: 'Unexpected error while merging PDFs. Please verify each file and retry.' });
    }
  }
);

router.post(
  '/pdf/split',
  optionalAuth,
  upload.single('file'),
  handleMulterError,
  async (req: AuthRequest, res: Response) => {
    const file = req.file;
    if (!file || !validateMagicBytes(file.buffer, ['pdf'])) {
      res.status(415).json({ error: 'Please upload a valid PDF file.' });
      return;
    }

    try {
      const src = await PDFLibDocument.load(file.buffer);
      const totalPages = src.getPageCount();
      const mode = String(req.body?.mode || 'range'); // 'range' | 'all-zip'
      const rangeStr = String(req.body?.pages || '1');

      if (mode === 'all-zip') {
        const zip = new JSZip();
        for (let i = 0; i < totalPages; i++) {
          const single = await PDFLibDocument.create();
          const [copied] = await single.copyPages(src, [i]);
          single.addPage(copied);
          const bytes = await single.save();
          zip.file(`page-${String(i + 1).padStart(3, '0')}.pdf`, bytes);
        }
        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
        const outName = sanitizeFilename(`${pathBaseWithoutExt(file.originalname)}-pages.zip`);
        const stored = await saveTempFile({
          buffer: zipBuffer,
          fileName: outName,
          mimeType: 'application/zip',
          originalSizeBytes: file.size,
          ownerUid: req.user?.uid || null,
          toolId: 'split-pdf',
          category: 'pdf',
        });

        await recordUserOperation({
          uid: req.user?.uid || null,
          toolId: 'split-pdf',
          toolName: 'Split PDF',
          category: 'pdf',
          fileName: outName,
          inputSizeBytes: file.size,
          outputSizeBytes: zipBuffer.length,
          status: 'completed',
          fileRecord: { id: stored.id, mimeType: 'application/zip', expiresAtMs: stored.expiresAt },
        });

        res.json({
          fileId: stored.id,
          fileName: stored.fileName,
          mimeType: 'application/zip',
          originalSizeBytes: file.size,
          outputSizeBytes: zipBuffer.length,
          pageCount: totalPages,
          downloadUrl: `/api/download/${encodeURIComponent(stored.secureToken)}`,
          expiresAt: stored.expiresAt,
        });
        return;
      }

      const indices = parsePageRanges(rangeStr, totalPages);
      if (indices.length === 0) {
        res.status(400).json({ error: `Enter valid page numbers between 1 and ${totalPages} (e.g. 1-3, 5).` });
        return;
      }

      const outDoc = await PDFLibDocument.create();
      const copied = await outDoc.copyPages(src, indices);
      copied.forEach((p) => outDoc.addPage(p));
      const outBuffer = Buffer.from(await outDoc.save({ useObjectStreams: true }));
      const outName = sanitizeFilename(`${pathBaseWithoutExt(file.originalname)}-split.pdf`);

      const stored = await saveTempFile({
        buffer: outBuffer,
        fileName: outName,
        mimeType: 'application/pdf',
        originalSizeBytes: file.size,
        ownerUid: req.user?.uid || null,
        toolId: 'split-pdf',
        category: 'pdf',
      });

      await recordUserOperation({
        uid: req.user?.uid || null,
        toolId: 'split-pdf',
        toolName: 'Split PDF',
        category: 'pdf',
        fileName: outName,
        inputSizeBytes: file.size,
        outputSizeBytes: outBuffer.length,
        status: 'completed',
        fileRecord: { id: stored.id, mimeType: 'application/pdf', expiresAtMs: stored.expiresAt },
      });

      res.json({
        fileId: stored.id,
        fileName: stored.fileName,
        mimeType: 'application/pdf',
        originalSizeBytes: file.size,
        outputSizeBytes: outBuffer.length,
        pageCount: outDoc.getPageCount(),
        downloadUrl: `/api/download/${encodeURIComponent(stored.secureToken)}`,
        expiresAt: stored.expiresAt,
      });
    } catch (err) {
      console.error('Split PDF error:', err);
      res.status(400).json({ error: 'Could not split this PDF. It may be encrypted or damaged.' });
    }
  }
);

router.post(
  '/pdf/compress',
  optionalAuth,
  upload.single('file'),
  handleMulterError,
  async (req: AuthRequest, res: Response) => {
    const file = req.file;
    if (!file || !validateMagicBytes(file.buffer, ['pdf'])) {
      res.status(415).json({ error: 'Please upload a valid PDF file.' });
      return;
    }

    try {
      const src = await PDFLibDocument.load(file.buffer);
      // Rebuild cleanly into fresh document to strip orphaned objects and enable object streams
      const cleanDoc = await PDFLibDocument.create();
      const copied = await cleanDoc.copyPages(src, src.getPageIndices());
      copied.forEach((p) => cleanDoc.addPage(p));
      cleanDoc.setProducer('RIKZEN PDF Optimizer');
      cleanDoc.setCreator('RIKZEN');

      const outBuffer = Buffer.from(
        await cleanDoc.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 100 })
      );
      const outName = sanitizeFilename(`${pathBaseWithoutExt(file.originalname)}-compressed.pdf`);

      const stored = await saveTempFile({
        buffer: outBuffer,
        fileName: outName,
        mimeType: 'application/pdf',
        originalSizeBytes: file.size,
        ownerUid: req.user?.uid || null,
        toolId: 'compress-pdf',
        category: 'pdf',
      });

      await recordUserOperation({
        uid: req.user?.uid || null,
        toolId: 'compress-pdf',
        toolName: 'Compress PDF',
        category: 'pdf',
        fileName: outName,
        inputSizeBytes: file.size,
        outputSizeBytes: outBuffer.length,
        status: 'completed',
        fileRecord: { id: stored.id, mimeType: 'application/pdf', expiresAtMs: stored.expiresAt },
      });

      res.json({
        fileId: stored.id,
        fileName: stored.fileName,
        mimeType: 'application/pdf',
        originalSizeBytes: file.size,
        outputSizeBytes: outBuffer.length,
        pageCount: cleanDoc.getPageCount(),
        downloadUrl: `/api/download/${encodeURIComponent(stored.secureToken)}`,
        expiresAt: stored.expiresAt,
      });
    } catch (err) {
      console.error('Compress PDF error:', err);
      res.status(400).json({ error: 'Could not optimize this PDF.' });
    }
  }
);

router.post(
  '/pdf/rotate',
  optionalAuth,
  upload.single('file'),
  handleMulterError,
  async (req: AuthRequest, res: Response) => {
    const file = req.file;
    if (!file || !validateMagicBytes(file.buffer, ['pdf'])) {
      res.status(415).json({ error: 'Please upload a valid PDF file.' });
      return;
    }

    try {
      const angle = Number(req.body?.angle || 90);
      const safeAngle = [90, 180, 270].includes(angle) ? angle : 90;
      const pageRange = String(req.body?.pages || 'all').trim();

      const pdf = await PDFLibDocument.load(file.buffer);
      const pages = pdf.getPages();
      const targetIndices =
        pageRange === '' || pageRange.toLowerCase() === 'all'
          ? pages.map((_, idx) => idx)
          : parsePageRanges(pageRange, pages.length);

      for (const idx of targetIndices) {
        const page = pages[idx];
        if (page) {
          const current = page.getRotation().angle;
          page.setRotation(degrees((current + safeAngle) % 360));
        }
      }

      const outBuffer = Buffer.from(await pdf.save({ useObjectStreams: true }));
      const outName = sanitizeFilename(`${pathBaseWithoutExt(file.originalname)}-rotated.pdf`);

      const stored = await saveTempFile({
        buffer: outBuffer,
        fileName: outName,
        mimeType: 'application/pdf',
        originalSizeBytes: file.size,
        ownerUid: req.user?.uid || null,
        toolId: 'rotate-pdf',
        category: 'pdf',
      });

      await recordUserOperation({
        uid: req.user?.uid || null,
        toolId: 'rotate-pdf',
        toolName: 'Rotate PDF',
        category: 'pdf',
        fileName: outName,
        inputSizeBytes: file.size,
        outputSizeBytes: outBuffer.length,
        status: 'completed',
        fileRecord: { id: stored.id, mimeType: 'application/pdf', expiresAtMs: stored.expiresAt },
      });

      res.json({
        fileId: stored.id,
        fileName: stored.fileName,
        mimeType: 'application/pdf',
        originalSizeBytes: file.size,
        outputSizeBytes: outBuffer.length,
        pageCount: pages.length,
        downloadUrl: `/api/download/${encodeURIComponent(stored.secureToken)}`,
        expiresAt: stored.expiresAt,
      });
    } catch (err) {
      console.error('Rotate PDF error:', err);
      res.status(400).json({ error: 'Could not rotate this PDF.' });
    }
  }
);

router.post(
  '/pdf/reorder',
  optionalAuth,
  upload.single('file'),
  handleMulterError,
  async (req: AuthRequest, res: Response) => {
    const file = req.file;
    if (!file || !validateMagicBytes(file.buffer, ['pdf'])) {
      res.status(415).json({ error: 'Please upload a valid PDF file.' });
      return;
    }

    try {
      const src = await PDFLibDocument.load(file.buffer);
      const total = src.getPageCount();
      let order: number[] = [];
      try {
        order = JSON.parse(String(req.body?.order || '[]'));
      } catch {
        order = [];
      }

      const validOrder = order.filter((n) => Number.isInteger(n) && n >= 0 && n < total);
      if (validOrder.length === 0) {
        res.status(400).json({ error: 'Select at least one page in the desired order.' });
        return;
      }

      const outDoc = await PDFLibDocument.create();
      const copied = await outDoc.copyPages(src, validOrder);
      copied.forEach((p) => outDoc.addPage(p));
      const outBuffer = Buffer.from(await outDoc.save({ useObjectStreams: true }));
      const outName = sanitizeFilename(`${pathBaseWithoutExt(file.originalname)}-reordered.pdf`);

      const stored = await saveTempFile({
        buffer: outBuffer,
        fileName: outName,
        mimeType: 'application/pdf',
        originalSizeBytes: file.size,
        ownerUid: req.user?.uid || null,
        toolId: 'reorder-pdf-pages',
        category: 'pdf',
      });

      await recordUserOperation({
        uid: req.user?.uid || null,
        toolId: 'reorder-pdf-pages',
        toolName: 'Reorder PDF Pages',
        category: 'pdf',
        fileName: outName,
        inputSizeBytes: file.size,
        outputSizeBytes: outBuffer.length,
        status: 'completed',
        fileRecord: { id: stored.id, mimeType: 'application/pdf', expiresAtMs: stored.expiresAt },
      });

      res.json({
        fileId: stored.id,
        fileName: stored.fileName,
        mimeType: 'application/pdf',
        originalSizeBytes: file.size,
        outputSizeBytes: outBuffer.length,
        pageCount: outDoc.getPageCount(),
        downloadUrl: `/api/download/${encodeURIComponent(stored.secureToken)}`,
        expiresAt: stored.expiresAt,
      });
    } catch (err) {
      console.error('Reorder PDF error:', err);
      res.status(400).json({ error: 'Could not reorder pages in this PDF.' });
    }
  }
);

router.post(
  '/pdf/jpg-to-pdf',
  optionalAuth,
  upload.array('files', MAX_FILES_PER_BATCH),
  handleMulterError,
  async (req: AuthRequest, res: Response) => {
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) {
      res.status(400).json({ error: 'Please select at least 1 image.' });
      return;
    }

    const batchCheck = validateTotalBatchBytes(files);
    if (!batchCheck.ok) {
      res.status(413).json({ code: 'BATCH_TOO_LARGE', error: batchCheck.error });
      return;
    }

    for (const f of files) {
      if (!validateMagicBytes(f.buffer, ['image'])) {
        res.status(415).json({ error: `"${f.originalname}" is not a valid image.` });
        return;
      }
    }

    try {
      const pageSizeMode = String(req.body?.pageSize || 'a4'); // 'a4' | 'letter' | 'fit'
      const orientation = String(req.body?.orientation || 'auto'); // 'auto' | 'portrait' | 'landscape'
      const marginMode = String(req.body?.margin || 'small'); // 'none' | 'small' | 'normal'
      const fitMode = String(req.body?.fitMode || 'contain'); // 'contain' | 'cover' | 'stretch'

      let rotations: number[] = [];
      try {
        const parsed = JSON.parse(String(req.body?.rotations || '[]'));
        if (Array.isArray(parsed)) rotations = parsed.map((n) => Number(n) || 0);
      } catch {
        rotations = [];
      }

      const marginPt = marginMode === 'none' ? 0 : marginMode === 'normal' ? 36 : 16;
      const pdfDoc = await PDFLibDocument.create();

      for (let idx = 0; idx < files.length; idx++) {
        const f = files[idx];
        const userRot = ((rotations[idx] || 0) % 360 + 360) % 360;

        let pipe = sharp(f.buffer, { failOn: 'none' }).rotate(); // auto-orient EXIF first
        if (userRot !== 0) {
          pipe = pipe.rotate(userRot);
        }

        // Convert to clean JPEG (or PNG if transparent and pageSize === 'fit') sequentially to keep RAM flat for 100 images
        const rotatedJpg = await pipe.flatten({ background: '#ffffff' }).jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true });
        const imgW = rotatedJpg.info.width;
        const imgH = rotatedJpg.info.height;

        if (pageSizeMode === 'fit') {
          const embedded = await pdfDoc.embedJpg(rotatedJpg.data);
          const page = pdfDoc.addPage([imgW + marginPt * 2, imgH + marginPt * 2]);
          page.drawImage(embedded, { x: marginPt, y: marginPt, width: imgW, height: imgH });
        } else {
          const baseW = pageSizeMode === 'letter' ? 612 : 595.28;
          const baseH = pageSizeMode === 'letter' ? 792 : 841.89;
          const isLandscape =
            orientation === 'landscape'
              ? true
              : orientation === 'portrait'
              ? false
              : imgW > imgH;

          const pageW = isLandscape ? baseH : baseW;
          const pageH = isLandscape ? baseW : baseH;
          const maxW = Math.max(10, pageW - marginPt * 2);
          const maxH = Math.max(10, pageH - marginPt * 2);
          const page = pdfDoc.addPage([pageW, pageH]);

          if (fitMode === 'cover') {
            // Crop image accurately to fill maxW x maxH aspect ratio without overflow
            const targetPxW = Math.min(2400, Math.round(maxW * 2));
            const targetPxH = Math.min(2400, Math.round(maxH * 2));
            const coverBuf = await sharp(rotatedJpg.data)
              .resize(targetPxW, targetPxH, { fit: 'cover', position: 'center' })
              .jpeg({ quality: 90, mozjpeg: true })
              .toBuffer();
            const embeddedCover = await pdfDoc.embedJpg(coverBuf);
            page.drawImage(embeddedCover, {
              x: marginPt,
              y: marginPt,
              width: maxW,
              height: maxH,
            });
          } else if (fitMode === 'stretch') {
            const embedded = await pdfDoc.embedJpg(rotatedJpg.data);
            page.drawImage(embedded, {
              x: marginPt,
              y: marginPt,
              width: maxW,
              height: maxH,
            });
          } else {
            // contain
            const embedded = await pdfDoc.embedJpg(rotatedJpg.data);
            const scale = Math.min(maxW / imgW, maxH / imgH);
            const drawW = imgW * scale;
            const drawH = imgH * scale;
            page.drawImage(embedded, {
              x: (pageW - drawW) / 2,
              y: (pageH - drawH) / 2,
              width: drawW,
              height: drawH,
            });
          }
        }
      }

      pdfDoc.setProducer('RIKZEN Image to PDF');
      pdfDoc.setCreator('RIKZEN');
      const outBuffer = Buffer.from(await pdfDoc.save({ useObjectStreams: true }));
      const outName = sanitizeFilename('rikzen-images.pdf');

      const stored = await saveTempFile({
        buffer: outBuffer,
        fileName: outName,
        mimeType: 'application/pdf',
        originalSizeBytes: batchCheck.totalBytes,
        ownerUid: req.user?.uid || null,
        toolId: 'jpg-to-pdf',
        category: 'pdf',
      });

      await recordUserOperation({
        uid: req.user?.uid || null,
        toolId: 'jpg-to-pdf',
        toolName: 'JPG to PDF',
        category: 'pdf',
        fileName: outName,
        inputSizeBytes: batchCheck.totalBytes,
        outputSizeBytes: outBuffer.length,
        status: 'completed',
        fileRecord: { id: stored.id, mimeType: 'application/pdf', expiresAtMs: stored.expiresAt },
      });

      res.json({
        fileId: stored.id,
        fileName: stored.fileName,
        mimeType: 'application/pdf',
        originalSizeBytes: batchCheck.totalBytes,
        outputSizeBytes: outBuffer.length,
        pageCount: pdfDoc.getPageCount(),
        downloadUrl: `/api/download/${encodeURIComponent(stored.secureToken)}`,
        expiresAt: stored.expiresAt,
      });
    } catch (err) {
      console.error('JPG to PDF error:', err);
      res.status(500).json({ error: 'Could not create PDF from images. Please check that all uploaded files are valid images.' });
    }
  }
);

router.post('/pdf/protect', optionalAuth, upload.single('file'), handleMulterError, async (_req: Request, res: Response) => {
  const hasQpdf = await checkQpdfAvailable();
  if (!hasQpdf) {
    res.status(503).json({
      code: 'BACKEND_NOT_CONFIGURED',
      error:
        'PDF password encryption requires the qpdf engine on the server, which is not installed in this environment.',
    });
    return;
  }
  res.status(501).json({ error: 'Use qpdf integration.' });
});

router.post('/pdf/unlock', optionalAuth, upload.single('file'), handleMulterError, async (_req: Request, res: Response) => {
  const hasQpdf = await checkQpdfAvailable();
  if (!hasQpdf) {
    res.status(503).json({
      code: 'BACKEND_NOT_CONFIGURED',
      error:
        'PDF decryption requires the qpdf engine on the server, which is not installed in this environment.',
    });
    return;
  }
  res.status(501).json({ error: 'Use qpdf integration.' });
});

// 4. DOCUMENT TOOLS (Word, Excel, PowerPoint, Text -> PDF / Convert)
router.post(
  '/document/convert',
  optionalAuth,
  upload.single('file'),
  handleMulterError,
  async (req: AuthRequest, res: Response) => {
    const toolId = String(req.body?.toolId || 'text-to-pdf');
    const toolName = String(req.body?.toolName || 'Document Converter');
    const targetFormat = String(req.body?.targetFormat || 'pdf').toLowerCase();
    const rawText = typeof req.body?.textContent === 'string' ? req.body.textContent : '';
    const file = req.file;

    if (!file && !rawText.trim()) {
      res.status(400).json({ error: 'Please upload a document or enter text first.' });
      return;
    }

    try {
      let outBuffer: Buffer;
      let outExt = targetFormat;
      let mimeType = 'application/pdf';
      const inputBytes = file ? file.size : Buffer.byteLength(rawText, 'utf8');
      const baseName = file ? pathBaseWithoutExt(file.originalname) : 'rikzen-document';
      const srcExt = file ? file.originalname.split('.').pop()?.toLowerCase() || '' : 'txt';

      if (toolId === 'text-to-pdf' || (!file && targetFormat === 'pdf')) {
        const content = file ? file.buffer.toString('utf8') : rawText;
        outBuffer = await renderPdfBufferFromLines(baseName, [
          { lines: content.split(/\r?\n/) },
        ]);
        outExt = 'pdf';
        mimeType = 'application/pdf';
      } else if (toolId === 'word-to-pdf' || (srcExt === 'docx' && targetFormat === 'pdf')) {
        const result = await mammoth.extractRawText({ buffer: file!.buffer });
        const lines = result.value.split(/\r?\n/).filter((l) => l !== undefined);
        outBuffer = await renderPdfBufferFromLines(baseName, [{ lines }]);
        outExt = 'pdf';
        mimeType = 'application/pdf';
      } else if (toolId === 'excel-to-pdf' || (['xlsx', 'xls', 'csv'].includes(srcExt) && targetFormat === 'pdf')) {
        const wb = XLSX.read(file!.buffer, { type: 'buffer' });
        const sections = wb.SheetNames.map((sheetName) => {
          const sheet = wb.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
          const lines = rows.map((row) => row.map((c) => String(c ?? '')).join('  |  '));
          return { heading: `Sheet: ${sheetName}`, lines: lines.length ? lines : ['(Empty sheet)'] };
        });
        outBuffer = await renderPdfBufferFromLines(baseName, sections);
        outExt = 'pdf';
        mimeType = 'application/pdf';
      } else if (toolId === 'powerpoint-to-pdf' || (srcExt === 'pptx' && targetFormat === 'pdf')) {
        const zip = await JSZip.loadAsync(file!.buffer);
        const slideFiles = Object.keys(zip.files)
          .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
          .sort((a, b) => {
            const na = Number(a.match(/\d+/)?.[0] || 0);
            const nb = Number(b.match(/\d+/)?.[0] || 0);
            return na - nb;
          });

        if (slideFiles.length === 0) {
          res.status(415).json({ error: 'Could not read slides from this PowerPoint file. Please upload a valid .pptx file.' });
          return;
        }

        const sections = [];
        for (let i = 0; i < slideFiles.length; i++) {
          const xml = await zip.files[slideFiles[i]].async('string');
          const matches = Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)).map((m) =>
            m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          );
          sections.push({
            heading: `Slide ${i + 1}`,
            lines: matches.length ? matches : ['(Visual / empty slide)'],
          });
        }
        outBuffer = await renderPdfBufferFromLines(baseName, sections);
        outExt = 'pdf';
        mimeType = 'application/pdf';
      } else if (srcExt === 'docx' && targetFormat === 'html') {
        const result = await mammoth.convertToHtml({ buffer: file!.buffer });
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>${baseName}</title></head><body>${result.value}</body></html>`;
        outBuffer = Buffer.from(html, 'utf8');
        outExt = 'html';
        mimeType = 'text/html';
      } else if (srcExt === 'docx' && targetFormat === 'txt') {
        const result = await mammoth.extractRawText({ buffer: file!.buffer });
        outBuffer = Buffer.from(result.value, 'utf8');
        outExt = 'txt';
        mimeType = 'text/plain; charset=utf-8';
      } else if (['xlsx', 'xls', 'csv'].includes(srcExt) && (targetFormat === 'csv' || targetFormat === 'json')) {
        const wb = XLSX.read(file!.buffer, { type: 'buffer' });
        const firstSheet = wb.Sheets[wb.SheetNames[0]];
        if (targetFormat === 'csv') {
          const csv = XLSX.utils.sheet_to_csv(firstSheet);
          outBuffer = Buffer.from(csv, 'utf8');
          outExt = 'csv';
          mimeType = 'text/csv';
        } else {
          const json = JSON.stringify(XLSX.utils.sheet_to_json(firstSheet), null, 2);
          outBuffer = Buffer.from(json, 'utf8');
          outExt = 'json';
          mimeType = 'application/json';
        }
      } else {
        const content = file ? file.buffer.toString('utf8') : rawText;
        outBuffer = await renderPdfBufferFromLines(baseName, [{ lines: content.split(/\r?\n/) }]);
        outExt = 'pdf';
        mimeType = 'application/pdf';
      }

      const outName = sanitizeFilename(`${baseName}.${outExt}`);
      const stored = await saveTempFile({
        buffer: outBuffer,
        fileName: outName,
        mimeType,
        originalSizeBytes: inputBytes,
        ownerUid: req.user?.uid || null,
        toolId,
        category: 'document',
      });

      await recordUserOperation({
        uid: req.user?.uid || null,
        toolId,
        toolName,
        category: 'document',
        fileName: outName,
        inputSizeBytes: inputBytes,
        outputSizeBytes: outBuffer.length,
        status: 'completed',
        fileRecord: { id: stored.id, mimeType, expiresAtMs: stored.expiresAt },
      });

      res.json({
        fileId: stored.id,
        fileName: stored.fileName,
        mimeType,
        originalSizeBytes: inputBytes,
        outputSizeBytes: outBuffer.length,
        downloadUrl: `/api/download/${encodeURIComponent(stored.secureToken)}`,
        expiresAt: stored.expiresAt,
      });
    } catch (err) {
      console.error('Document conversion error:', err);
      res.status(400).json({ error: 'Could not convert this document. Please check that the file is not corrupted.' });
    }
  }
);

// 5. SERVER-SIDE QR GENERATION
router.post('/qr/generate', optionalAuth, async (req: AuthRequest, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  const format = req.body?.format === 'svg' ? 'svg' : 'png';
  const darkColor = typeof req.body?.darkColor === 'string' ? req.body.darkColor : '#0B0C0E';
  const lightColor = typeof req.body?.lightColor === 'string' ? req.body.lightColor : '#FFFFFF';
  const size = Math.min(1200, Math.max(128, Number(req.body?.size || 512)));

  if (!text) {
    res.status(400).json({ error: 'Please enter text or a URL for the QR code.' });
    return;
  }

  try {
    let outBuffer: Buffer;
    let mimeType: string;
    let ext: string;

    if (format === 'svg') {
      const svg = await QRCode.toString(text, {
        type: 'svg',
        width: size,
        margin: 2,
        color: { dark: darkColor, light: lightColor },
      });
      outBuffer = Buffer.from(svg, 'utf8');
      mimeType = 'image/svg+xml';
      ext = 'svg';
    } else {
      outBuffer = await QRCode.toBuffer(text, {
        type: 'png',
        width: size,
        margin: 2,
        color: { dark: darkColor, light: lightColor },
      });
      mimeType = 'image/png';
      ext = 'png';
    }

    const outName = sanitizeFilename(`rikzen-qr.${ext}`);
    const stored = await saveTempFile({
      buffer: outBuffer,
      fileName: outName,
      mimeType,
      originalSizeBytes: Buffer.byteLength(text, 'utf8'),
      ownerUid: req.user?.uid || null,
      toolId: 'qr-generator',
      category: 'utility',
    });

    await recordUserOperation({
      uid: req.user?.uid || null,
      toolId: 'qr-generator',
      toolName: 'QR Generator',
      category: 'utility',
      fileName: outName,
      inputSizeBytes: Buffer.byteLength(text, 'utf8'),
      outputSizeBytes: outBuffer.length,
      status: 'completed',
      fileRecord: { id: stored.id, mimeType, expiresAtMs: stored.expiresAt },
    });

    res.json({
      fileId: stored.id,
      fileName: stored.fileName,
      mimeType,
      originalSizeBytes: Buffer.byteLength(text, 'utf8'),
      outputSizeBytes: outBuffer.length,
      downloadUrl: `/api/download/${encodeURIComponent(stored.secureToken)}`,
      previewUrl: `/api/download/${encodeURIComponent(stored.secureToken)}?inline=1`,
      expiresAt: stored.expiresAt,
    });
  } catch (err) {
    console.error('QR generation error:', err);
    res.status(500).json({ error: 'Failed to generate QR code.' });
  }
});

// 6. BATCH ZIP BUNDLER (Safely bundles processed temp files into a single ZIP without re-upload)
router.post('/batch/zip', optionalAuth, async (req: AuthRequest, res: Response) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const archiveName = sanitizeFilename(String(req.body?.archiveName || 'rikzen-batch.zip'));

  const maxZipItems = Math.max(50, MAX_FILES_PER_BATCH * 2);
  if (items.length === 0 || items.length > maxZipItems) {
    res.status(400).json({ error: `Provide between 1 and ${maxZipItems} processed items to archive.` });
    return;
  }

  try {
    const fs = await import('fs');
    const zip = new JSZip();
    let totalInput = 0;
    const usedNames = new Set<string>();

    for (const item of items) {
      let record: ReturnType<typeof getTempFile> | undefined;
      if (item?.secureToken) {
        const parsed = parseAndVerifySecureToken(String(item.secureToken));
        if (parsed.valid) {
          record = parsed.record;
        }
      } else {
        const fileId = String(item?.fileId || '');
        const token = String(item?.token || '');
        const candidate = getTempFile(fileId);
        if (candidate && verifyDownloadToken(candidate.id, token, candidate.expiresAt)) {
          record = candidate;
        }
      }
      if (!record) {
        continue;
      }
      if (record.ownerUid && req.user?.uid && record.ownerUid !== req.user.uid) {
        continue;
      }
      const data = await fs.promises.readFile(record.filePath);
      let entryName = record.fileName;
      let counter = 1;
      while (usedNames.has(entryName)) {
        const dot = record.fileName.lastIndexOf('.');
        entryName =
          dot > 0
            ? `${record.fileName.slice(0, dot)}-${counter}${record.fileName.slice(dot)}`
            : `${record.fileName}-${counter}`;
        counter++;
      }
      usedNames.add(entryName);
      zip.file(entryName, data);
      totalInput += record.originalSizeBytes || data.length;
    }

    if (usedNames.size === 0) {
      res.status(404).json({ error: 'No valid or non-expired files were found to bundle.' });
      return;
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    const outName = archiveName.endsWith('.zip') ? archiveName : `${archiveName}.zip`;

    const stored = await saveTempFile({
      buffer: zipBuffer,
      fileName: outName,
      mimeType: 'application/zip',
      originalSizeBytes: totalInput,
      ownerUid: req.user?.uid || null,
      toolId: String(req.body?.toolId || 'batch-zip'),
      category: String(req.body?.category || 'image'),
    });

    res.json({
      fileId: stored.id,
      fileName: stored.fileName,
      mimeType: 'application/zip',
      originalSizeBytes: totalInput,
      outputSizeBytes: zipBuffer.length,
      fileCount: usedNames.size,
      downloadUrl: `/api/download/${encodeURIComponent(stored.secureToken)}`,
      expiresAt: stored.expiresAt,
    });
  } catch (err) {
    console.error('Batch ZIP error:', err);
    res.status(500).json({ error: 'Could not create batch ZIP archive.' });
  }
});

// Log client-side tool completions (PDF-to-JPG, PDF-to-Text, Student Calculators, Barcode, etc.)
router.post('/client-log', optionalAuth, async (req: AuthRequest, res) => {
  const toolId = String(req.body?.toolId || '').slice(0, 80);
  const toolName = String(req.body?.toolName || '').slice(0, 120);
  const category = String(req.body?.category || 'utility').slice(0, 60);
  const fileName = String(req.body?.fileName || 'Browser Result').slice(0, 250);
  const inputSizeBytes = Math.max(0, Number(req.body?.inputSizeBytes || 0));
  const outputSizeBytes = Math.max(0, Number(req.body?.outputSizeBytes || 0));

  if (!toolId || !toolName) {
    res.status(400).json({ error: 'Missing toolId or toolName.' });
    return;
  }

  await recordUserOperation({
    uid: req.user?.uid || null,
    toolId,
    toolName,
    category,
    fileName,
    inputSizeBytes,
    outputSizeBytes,
    status: 'completed',
  });

  res.json({ ok: true });
});

function pathBaseWithoutExt(filename: string): string {
  const clean = sanitizeFilename(filename, 'file');
  const idx = clean.lastIndexOf('.');
  return idx > 0 ? clean.slice(0, idx) : clean;
}

function parsePageRanges(rangeStr: string, totalPages: number): number[] {
  const result: number[] = [];
  const seen = new Set<number>();
  const parts = rangeStr.split(',').map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    if (part.includes('-')) {
      const [aStr, bStr] = part.split('-');
      const a = Number(aStr);
      const b = Number(bStr);
      if (Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b >= a && b <= totalPages) {
        for (let p = a; p <= b; p++) {
          if (!seen.has(p - 1)) {
            seen.add(p - 1);
            result.push(p - 1);
          }
        }
      }
    } else {
      const p = Number(part);
      if (Number.isInteger(p) && p >= 1 && p <= totalPages && !seen.has(p - 1)) {
        seen.add(p - 1);
        result.push(p - 1);
      }
    }
  }
  return result;
}

export default router;
