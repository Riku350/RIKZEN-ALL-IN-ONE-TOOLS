import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { sanitizeFilename } from './tempStorage.ts';

const execFileAsync = promisify(execFile);

export type QrContentType =
  | 'link'
  | 'text'
  | 'contact'
  | 'wifi'
  | 'email'
  | 'phone'
  | 'location'
  | 'image'
  | 'video'
  | 'file';

export type QrExpirationPreset = 'never' | '1d' | '7d' | '30d' | 'custom';

export interface QrDesignConfig {
  template: 'classic' | 'rikzen' | 'premium' | 'minimal' | 'photo' | 'video';
  fgColor: string;
  bgColor: string;
  transparentBg: boolean;
  moduleStyle: 'square' | 'rounded';
  eyeStyle: 'square' | 'rounded';
  logoMode: 'none' | 'rikzen' | 'photo' | 'video';
  resolution: 512 | 1024 | 2048;
}

export interface QrShareRecord {
  shareId: string;
  ownerUid: string | null;
  name: string;
  qrType: QrContentType;
  payload: string;
  shareUrl: string;
  // Media/File attributes (when qrType is image | video | file)
  filePath?: string;
  thumbnailPath?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes: number;
  durationSec?: number | null;
  width?: number | null;
  height?: number | null;
  design?: QrDesignConfig;
  expirationPreset: QrExpirationPreset;
  expiresAt: number | null; // null = permanent
  createdAt: number;
  updatedAt: number;
}

const VAULT_DIR = process.env.QR_STORAGE_DIR
  ? path.resolve(process.env.QR_STORAGE_DIR)
  : path.join(os.tmpdir(), 'rikzen-qr-vault');
const MEDIA_DIR = path.join(VAULT_DIR, 'media');
const THUMB_DIR = path.join(VAULT_DIR, 'thumbs');
const INDEX_FILE = path.join(VAULT_DIR, 'records.json');

for (const dir of [VAULT_DIR, MEDIA_DIR, THUMB_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getQrLimits() {
  return {
    maxQrImageMb: Math.min(100, Math.max(1, Number(process.env.MAX_QR_IMAGE_SIZE_MB || '25'))),
    maxQrVideoMb: Math.min(250, Math.max(5, Number(process.env.MAX_QR_VIDEO_SIZE_MB || '100'))),
    maxQrFileMb: Math.min(150, Math.max(1, Number(process.env.MAX_QR_FILE_SIZE_MB || '50'))),
    maxQrStoragePerUserMb: Math.min(
      5000,
      Math.max(25, Number(process.env.MAX_QR_STORAGE_PER_USER_MB || '500'))
    ),
  };
}

const recordsMap = new Map<string, QrShareRecord>();

// Load persisted QR index cleanly on boot
try {
  if (fs.existsSync(INDEX_FILE)) {
    const raw = fs.readFileSync(INDEX_FILE, 'utf8');
    const parsed = JSON.parse(raw) as QrShareRecord[];
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item.shareId === 'string') {
          recordsMap.set(item.shareId, item);
        }
      }
    }
  }
} catch (err) {
  console.error('Could not load QR vault index:', err);
}

let writeQueue: Promise<void> = Promise.resolve();
function persistIndex() {
  writeQueue = writeQueue
    .then(async () => {
      const tmp = `${INDEX_FILE}.tmp`;
      const data = JSON.stringify(Array.from(recordsMap.values()), null, 2);
      await fs.promises.writeFile(tmp, data, 'utf8');
      await fs.promises.rename(tmp, INDEX_FILE);
    })
    .catch((err) => {
      console.error('Failed to persist QR vault index:', err);
    });
  return writeQueue;
}

export function generateShareId(): string {
  // 12 random bytes = 16 URL-safe chars, cryptographically unguessable
  return crypto.randomBytes(12).toString('base64url');
}

export function isValidShareId(shareId: string): boolean {
  return typeof shareId === 'string' && /^[A-Za-z0-9_-]{8,32}$/.test(shareId);
}

export function resolveExpirationMs(
  preset: QrExpirationPreset,
  customExpiresAt?: string | number | null
): number | null {
  const now = Date.now();
  if (preset === '1d') return now + 24 * 60 * 60 * 1000;
  if (preset === '7d') return now + 7 * 24 * 60 * 60 * 1000;
  if (preset === '30d') return now + 30 * 24 * 60 * 60 * 1000;
  if (preset === 'custom' && customExpiresAt) {
    const ts = typeof customExpiresAt === 'number' ? customExpiresAt : Date.parse(String(customExpiresAt));
    if (Number.isFinite(ts) && ts > now + 60 * 1000) {
      return ts;
    }
  }
  return null;
}

export function isRecordExpired(record: QrShareRecord): boolean {
  return record.expiresAt !== null && Date.now() > record.expiresAt;
}

export function getUserQrStorageBytes(ownerUid: string): number {
  let total = 0;
  for (const r of recordsMap.values()) {
    if (r.ownerUid === ownerUid && !isRecordExpired(r)) {
      total += r.sizeBytes || 0;
    }
  }
  return total;
}

export function getQrRecord(shareId: string): QrShareRecord | undefined {
  if (!isValidShareId(shareId)) return undefined;
  return recordsMap.get(shareId);
}

export function listUserQrRecords(ownerUid: string): QrShareRecord[] {
  const items: QrShareRecord[] = [];
  for (const r of recordsMap.values()) {
    if (r.ownerUid === ownerUid && !isRecordExpired(r)) {
      items.push(r);
    }
  }
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveQrRecord(record: QrShareRecord): Promise<QrShareRecord> {
  recordsMap.set(record.shareId, record);
  await persistIndex();
  return record;
}

export async function updateQrRecord(
  shareId: string,
  updates: Partial<
    Pick<QrShareRecord, 'name' | 'payload' | 'design' | 'expirationPreset' | 'expiresAt' | 'updatedAt'>
  >
): Promise<QrShareRecord | null> {
  const existing = recordsMap.get(shareId);
  if (!existing) return null;
  const next: QrShareRecord = {
    ...existing,
    ...updates,
    updatedAt: Date.now(),
  };
  recordsMap.set(shareId, next);
  await persistIndex();
  return next;
}

export async function deleteQrRecord(shareId: string): Promise<boolean> {
  const record = recordsMap.get(shareId);
  if (!record) return false;
  recordsMap.delete(shareId);
  if (record.filePath) {
    await fs.promises.unlink(record.filePath).catch(() => {});
  }
  if (record.thumbnailPath) {
    await fs.promises.unlink(record.thumbnailPath).catch(() => {});
  }
  await persistIndex();
  return true;
}

export function startQrCleanupLoop() {
  const timer = setInterval(async () => {
    const expiredIds: string[] = [];
    for (const [id, rec] of recordsMap.entries()) {
      if (isRecordExpired(rec)) {
        expiredIds.push(id);
      }
    }
    for (const id of expiredIds) {
      await deleteQrRecord(id);
    }
  }, 2 * 60 * 1000);
  timer.unref();
}

export async function validateVideoMagicBytes(filePath: string): Promise<{ valid: boolean; detectedMime?: string }> {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(64);
    const { bytesRead } = await fh.read(buf, 0, 64, 0);
    if (bytesRead < 12) return { valid: false };

    // WebM / Matroska EBML header: 1A 45 DF A3
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
      return { valid: true, detectedMime: 'video/webm' };
    }

    // ISO Base Media File Format (MP4 / MOV / M4V): ftyp / moov / wide / mdat / free
    const boxType = buf.subarray(4, 8).toString('ascii');
    if (['ftyp', 'moov', 'wide', 'mdat', 'free', 'skip'].includes(boxType)) {
      const brand = buf.subarray(8, 12).toString('ascii');
      if (brand === 'qt  ') {
        return { valid: true, detectedMime: 'video/quicktime' };
      }
      return { valid: true, detectedMime: 'video/mp4' };
    }

    // AVI: RIFF....AVI
    if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 11).toString('ascii') === 'AVI') {
      return { valid: true, detectedMime: 'video/x-msvideo' };
    }

    return { valid: false };
  } finally {
    await fh.close();
  }
}

export async function validateGeneralFileSignature(
  filePath: string,
  originalMime: string,
  ext: string
): Promise<{ valid: boolean; safeMime: string }> {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(512);
    const { bytesRead } = await fh.read(buf, 0, 512, 0);
    if (bytesRead === 0) return { valid: false, safeMime: 'application/octet-stream' };

    // Strictly reject executables / shell scripts / HTML XSS
    const isExe = buf[0] === 0x4d && buf[1] === 0x5a; // MZ
    const isElf = buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46; // ELF
    const isMachO =
      (buf[0] === 0xcf && buf[1] === 0xfa && buf[2] === 0xed && buf[3] === 0xfe) ||
      (buf[0] === 0xfe && buf[1] === 0xed && buf[2] === 0xfa && buf[3] === 0xcf);
    if (isExe || isElf || isMachO) {
      return { valid: false, safeMime: 'application/octet-stream' };
    }

    const headStr = buf.subarray(0, bytesRead).toString('latin1');
    if (headStr.includes('%PDF-')) {
      return { valid: true, safeMime: 'application/pdf' };
    }
    if (buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05)) {
      const lowerExt = ext.toLowerCase();
      if (lowerExt === '.docx') {
        return {
          valid: true,
          safeMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        };
      }
      if (lowerExt === '.xlsx') {
        return {
          valid: true,
          safeMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        };
      }
      if (lowerExt === '.pptx') {
        return {
          valid: true,
          safeMime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        };
      }
      return { valid: true, safeMime: 'application/zip' };
    }
    if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) {
      return { valid: true, safeMime: originalMime || 'application/octet-stream' };
    }

    const lowerExt = ext.toLowerCase();
    const safeTextMimes: Record<string, string> = {
      '.txt': 'text/plain; charset=utf-8',
      '.csv': 'text/csv; charset=utf-8',
      '.md': 'text/markdown; charset=utf-8',
      '.json': 'application/json',
    };
    if (safeTextMimes[lowerExt]) {
      return { valid: true, safeMime: safeTextMimes[lowerExt] };
    }

    // Allow generic non-executable downloadable attachments as octet-stream
    if (['.html', '.htm', '.svg', '.js', '.mjs', '.sh', '.bat', '.cmd', '.ps1'].includes(lowerExt)) {
      return { valid: false, safeMime: 'application/octet-stream' };
    }

    return { valid: true, safeMime: 'application/octet-stream' };
  } finally {
    await fh.close();
  }
}

/**
 * Extract MP4/MOV duration cleanly without requiring external binaries,
 * falling back to ffprobe if available in runtime.
 */
export async function probeVideoMetadata(
  filePath: string
): Promise<{ durationSec: number | null; width: number | null; height: number | null }> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height:format=duration',
        '-of',
        'json',
        filePath,
      ],
      { timeout: 3000 }
    );
    const parsed = JSON.parse(stdout) as {
      streams?: { width?: number; height?: number }[];
      format?: { duration?: string };
    };
    const stream = parsed.streams?.[0];
    const dur = parsed.format?.duration ? Number(parsed.format.duration) : null;
    return {
      durationSec: dur && Number.isFinite(dur) ? Math.round(dur * 10) / 10 : null,
      width: stream?.width || null,
      height: stream?.height || null,
    };
  } catch {
    // Parse MP4 moov -> mvhd atom natively in pure Node.js
    try {
      const stat = await fs.promises.stat(filePath);
      const fh = await fs.promises.open(filePath, 'r');
      try {
        // Scan top-level atoms up to 16MB or end for small/fast-start moov
        const maxScan = Math.min(stat.size, 8 * 1024 * 1024);
        let offset = 0;
        const header = Buffer.alloc(16);
        while (offset + 8 < maxScan) {
          await fh.read(header, 0, 16, offset);
          let size = header.readUInt32BE(0);
          const type = header.subarray(4, 8).toString('ascii');
          if (size === 1) {
            size = Number(header.readBigUInt64BE(8));
          } else if (size === 0) {
            size = stat.size - offset;
          }
          if (size < 8) break;
          if (type === 'moov') {
            const moovLen = Math.min(size, 512 * 1024);
            const moovBuf = Buffer.alloc(moovLen);
            await fh.read(moovBuf, 0, moovLen, offset);
            const mvhdIdx = moovBuf.indexOf('mvhd');
            if (mvhdIdx >= 4 && mvhdIdx + 24 < moovBuf.length) {
              const version = moovBuf[mvhdIdx + 4];
              if (version === 0) {
                const timescale = moovBuf.readUInt32BE(mvhdIdx + 16);
                const duration = moovBuf.readUInt32BE(mvhdIdx + 20);
                if (timescale > 0) {
                  return {
                    durationSec: Math.round((duration / timescale) * 10) / 10,
                    width: null,
                    height: null,
                  };
                }
              } else if (version === 1 && mvhdIdx + 36 < moovBuf.length) {
                const timescale = moovBuf.readUInt32BE(mvhdIdx + 24);
                const duration = Number(moovBuf.readBigUInt64BE(mvhdIdx + 28));
                if (timescale > 0) {
                  return {
                    durationSec: Math.round((duration / timescale) * 10) / 10,
                    width: null,
                    height: null,
                  };
                }
              }
            }
            break;
          }
          offset += size;
        }
      } finally {
        await fh.close();
      }
    } catch {
      // Ignore header parse edge cases
    }
    return { durationSec: null, width: null, height: null };
  }
}

export async function processAndStoreQrImage(
  inputPath: string,
  shareId: string,
  originalName: string
): Promise<{
  filePath: string;
  thumbnailPath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}> {
  const inputBuffer = await fs.promises.readFile(inputPath);
  const head = inputBuffer.subarray(0, 16);
  const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const isGif = head.subarray(0, 4).toString('ascii') === 'GIF8';
  const isWebp =
    head.subarray(0, 4).toString('ascii') === 'RIFF' &&
    head.subarray(8, 12).toString('ascii') === 'WEBP';

  if (!isJpeg && !isPng && !isGif && !isWebp) {
    throw new Error('Unsupported image format. Please upload JPG, PNG, WebP, or GIF.');
  }

  const meta = await sharp(inputBuffer, { animated: isGif }).metadata();
  const baseName = sanitizeFilename(originalName).replace(/\.[^.]+$/, '') || 'rikzen-image';

  let outBuffer: Buffer;
  let ext: string;
  let mimeType: string;

  if (isGif) {
    // Preserve animated GIF while stripping extra metadata
    outBuffer = await sharp(inputBuffer, { animated: true }).gif().toBuffer();
    ext = 'gif';
    mimeType = 'image/gif';
  } else if (isPng) {
    outBuffer = await sharp(inputBuffer)
      .rotate()
      .resize(2400, 2400, { fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 8 })
      .toBuffer();
    ext = 'png';
    mimeType = 'image/png';
  } else if (isWebp) {
    outBuffer = await sharp(inputBuffer)
      .rotate()
      .resize(2400, 2400, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 88 })
      .toBuffer();
    ext = 'webp';
    mimeType = 'image/webp';
  } else {
    outBuffer = await sharp(inputBuffer)
      .rotate()
      .resize(2400, 2400, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
    ext = 'jpg';
    mimeType = 'image/jpeg';
  }

  const finalName = `${baseName}.${ext}`;
  const finalPath = path.join(MEDIA_DIR, `${shareId}.${ext}`);
  await fs.promises.writeFile(finalPath, outBuffer);

  // Generate compact WebP thumbnail for fast dashboards & previews
  const thumbBuffer = await sharp(inputBuffer)
    .rotate()
    .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();
  const thumbPath = path.join(THUMB_DIR, `${shareId}.webp`);
  await fs.promises.writeFile(thumbPath, thumbBuffer);

  return {
    filePath: finalPath,
    thumbnailPath: thumbPath,
    fileName: finalName,
    mimeType,
    sizeBytes: outBuffer.length,
    width: meta.width || null,
    height: meta.height || null,
  };
}

export async function storeQrVideoOrFile(params: {
  tempPath: string;
  thumbTempPath?: string;
  shareId: string;
  originalName: string;
  mimeType: string;
}): Promise<{
  filePath: string;
  thumbnailPath?: string;
  fileName: string;
  sizeBytes: number;
}> {
  const cleanName = sanitizeFilename(params.originalName);
  const ext = path.extname(cleanName).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12) || '.bin';
  const destPath = path.join(MEDIA_DIR, `${params.shareId}${ext}`);
  await fs.promises.copyFile(params.tempPath, destPath);
  const stat = await fs.promises.stat(destPath);

  let thumbnailPath: string | undefined;
  if (params.thumbTempPath) {
    try {
      const thumbBuf = await sharp(await fs.promises.readFile(params.thumbTempPath))
        .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      const tPath = path.join(THUMB_DIR, `${params.shareId}.webp`);
      await fs.promises.writeFile(tPath, thumbBuf);
      thumbnailPath = tPath;
    } catch {
      // Optional thumbnail failed cleanly
    }
  }

  return {
    filePath: destPath,
    thumbnailPath,
    fileName: cleanName,
    sizeBytes: stat.size,
  };
}
