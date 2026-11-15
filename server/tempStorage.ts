import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

export interface StoredTempFile {
  id: string;
  filePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  originalSizeBytes: number;
  ownerUid: string | null;
  downloadToken: string;
  secureToken: string;
  toolId: string;
  category: string;
  createdAt: number;
  expiresAt: number;
}

const TEMP_DIR = path.join(os.tmpdir(), 'rikzen-temp-files');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const TOKEN_SECRET = process.env.TEMP_TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
const fileRegistry = new Map<string, StoredTempFile>();

export function getTempFileTtlMs(): number {
  const mins = Number(process.env.TEMP_FILE_TTL_MINUTES || '30');
  return (Number.isFinite(mins) && mins > 0 ? mins : 30) * 60 * 1000;
}

export function sanitizeFilename(name: string, fallback = 'rikzen-output'): string {
  const base = path.basename(name || fallback);
  const cleaned = base
    .replace(/[\x00-\x1f\x7f<>:"/\\|?*]+/g, '_')
    .replace(/\.{2,}/g, '.')
    .trim();
  return (cleaned || fallback).slice(0, 180);
}

export function buildContentDisposition(fileName: string, inline: boolean): string {
  const safeName = sanitizeFilename(fileName);
  const asciiFallback = safeName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  const encoded = encodeURIComponent(safeName).replace(/['()*!]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `${inline ? 'inline' : 'attachment'}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

export function signDownloadToken(fileId: string, expiresAt: number): string {
  return crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(`${fileId}:${expiresAt}`)
    .digest('base64url');
}

export function verifyDownloadToken(fileId: string, token: string, expiresAt: number): boolean {
  const expected = signDownloadToken(fileId, expiresAt);
  if (expected.length === token.length) {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  }
  // Backwards-compatibility check for legacy hex HMACs during transition
  const expectedHex = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(`${fileId}:${expiresAt}`)
    .digest('hex');
  if (expectedHex.length === token.length) {
    return crypto.timingSafeEqual(Buffer.from(expectedHex), Buffer.from(token));
  }
  return false;
}

export function createSecureDownloadToken(fileId: string, expiresAt: number): string {
  const sig = signDownloadToken(fileId, expiresAt);
  return `${fileId}.${expiresAt.toString(36)}.${sig}`;
}

export function parseAndVerifySecureToken(
  secureToken: string
):
  | { valid: true; record: StoredTempFile }
  | { valid: false; reason: 'invalid' | 'expired'; fileId?: string } {
  if (!secureToken || typeof secureToken !== 'string') {
    return { valid: false, reason: 'invalid' };
  }
  const parts = secureToken.split('.');
  if (parts.length !== 3) {
    return { valid: false, reason: 'invalid' };
  }
  const [fileId, exp36, sig] = parts;
  if (!fileId || !exp36 || !sig) {
    return { valid: false, reason: 'invalid' };
  }
  const expiresAt = parseInt(exp36, 36);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    return { valid: false, reason: 'invalid' };
  }
  if (!verifyDownloadToken(fileId, sig, expiresAt)) {
    return { valid: false, reason: 'invalid' };
  }

  // Signature is genuine. Check expiration first:
  if (Date.now() > expiresAt) {
    void deleteTempFile(fileId);
    return { valid: false, reason: 'expired', fileId };
  }

  const record = fileRegistry.get(fileId);
  if (!record) {
    // Valid signature & within timestamp window, but deleted / server restarted
    return { valid: false, reason: 'expired', fileId };
  }
  if (Date.now() > record.expiresAt) {
    void deleteTempFile(fileId);
    return { valid: false, reason: 'expired', fileId };
  }

  return { valid: true, record };
}

export function getDownloadUrls(record: StoredTempFile) {
  return {
    secureToken: record.secureToken,
    downloadUrl: `/api/download/${encodeURIComponent(record.secureToken)}`,
    previewUrl: `/api/download/${encodeURIComponent(record.secureToken)}?inline=1`,
  };
}

export async function saveTempFile(params: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  originalSizeBytes: number;
  ownerUid: string | null;
  toolId: string;
  category: string;
}): Promise<StoredTempFile> {
  const id = crypto.randomUUID().replace(/-/g, '');
  const cleanName = sanitizeFilename(params.fileName);
  const filePath = path.join(TEMP_DIR, `${id}-${cleanName}`);
  await fs.promises.writeFile(filePath, params.buffer);

  const now = Date.now();
  const expiresAt = now + getTempFileTtlMs();
  const downloadToken = signDownloadToken(id, expiresAt);
  const secureToken = createSecureDownloadToken(id, expiresAt);

  const record: StoredTempFile = {
    id,
    filePath,
    fileName: cleanName,
    mimeType: params.mimeType,
    sizeBytes: params.buffer.length,
    originalSizeBytes: params.originalSizeBytes,
    ownerUid: params.ownerUid,
    downloadToken,
    secureToken,
    toolId: params.toolId,
    category: params.category,
    createdAt: now,
    expiresAt,
  };

  fileRegistry.set(id, record);
  return record;
}

export function getTempFile(id: string): StoredTempFile | undefined {
  const record = fileRegistry.get(id);
  if (!record) return undefined;
  if (Date.now() > record.expiresAt) {
    void deleteTempFile(id);
    return undefined;
  }
  return record;
}

export async function deleteTempFile(id: string): Promise<boolean> {
  const record = fileRegistry.get(id);
  fileRegistry.delete(id);
  if (record) {
    try {
      await fs.promises.unlink(record.filePath);
    } catch {
      // Already removed
    }
    return true;
  }
  return false;
}

export function getStorageStats() {
  let totalBytes = 0;
  let activeFiles = 0;
  const now = Date.now();
  for (const record of fileRegistry.values()) {
    if (record.expiresAt > now) {
      totalBytes += record.sizeBytes;
      activeFiles += 1;
    }
  }
  return { activeFiles, totalBytes };
}

export function startTempCleanupLoop() {
  const timer = setInterval(async () => {
    const now = Date.now();
    for (const [id, record] of fileRegistry.entries()) {
      if (now > record.expiresAt) {
        await deleteTempFile(id);
      }
    }
  }, 60 * 1000);
  timer.unref();
}

export function validateMagicBytes(buffer: Buffer, allowedKinds: ('image' | 'pdf' | 'office' | 'text')[]): boolean {
  if (!buffer || buffer.length === 0) return false;
  const head = buffer.subarray(0, 16);

  const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const isGif = head.subarray(0, 4).toString('ascii') === 'GIF8';
  const isWebp =
    head.subarray(0, 4).toString('ascii') === 'RIFF' &&
    head.subarray(8, 12).toString('ascii') === 'WEBP';
  const isTiff =
    (head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a && head[3] === 0x00) ||
    (head[0] === 0x4d && head[1] === 0x4d && head[2] === 0x00 && head[3] === 0x2a);
  const isAvif = head.subarray(4, 8).toString('ascii') === 'ftyp';
  const isPdf = buffer.subarray(0, 512).toString('latin1').includes('%PDF-');
  const isZip = head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05);
  const isOle =
    head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;

  if (allowedKinds.includes('image') && (isJpeg || isPng || isGif || isWebp || isTiff || isAvif)) {
    return true;
  }
  if (allowedKinds.includes('pdf') && isPdf) {
    return true;
  }
  if (allowedKinds.includes('office') && (isZip || isOle)) {
    return true;
  }
  if (allowedKinds.includes('text')) {
    // Reject obvious binary/executable signatures (MZ, ELF)
    const isExe = head[0] === 0x4d && head[1] === 0x5a;
    const isElf = head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46;
    if (!isExe && !isElf) return true;
  }
  return false;
}
