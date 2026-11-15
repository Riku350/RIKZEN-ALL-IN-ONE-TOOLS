import dns from 'dns/promises';
import net from 'net';
import sharp from 'sharp';
import { sanitizeFilename } from './tempStorage.ts';

export class UnsafeUrlError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'UnsafeUrlError';
    this.status = status;
  }
}

export class ImageFetchError extends Error {
  status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.name = 'ImageFetchError';
    this.status = status;
  }
}

const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/tiff',
]);

const ALLOWED_SHARP_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'tiff']);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let val = 0;
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    val = (val << 8) + n;
  }
  return val >>> 0;
}

function isBlockedIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true;

  const first = (n >>> 24) & 0xff;
  const second = (n >>> 16) & 0xff;
  const third = (n >>> 8) & 0xff;

  // 0.0.0.0/8 (this host/network)
  if (first === 0) return true;
  // 10.0.0.0/8 (private RFC1918)
  if (first === 10) return true;
  // 100.64.0.0/10 (Carrier-grade NAT RFC6598)
  if (first === 100 && second >= 64 && second <= 127) return true;
  // 127.0.0.0/8 (loopback)
  if (first === 127) return true;
  // 169.254.0.0/16 (link-local + cloud instance metadata 169.254.169.254)
  if (first === 169 && second === 254) return true;
  // 172.16.0.0/12 (private RFC1918)
  if (first === 172 && second >= 16 && second <= 31) return true;
  // 192.0.0.0/24 (IETF protocol assignments)
  if (first === 192 && second === 0 && third === 0) return true;
  // 192.0.2.0/24 (TEST-NET-1)
  if (first === 192 && second === 0 && third === 2) return true;
  // 192.168.0.0/16 (private RFC1918)
  if (first === 192 && second === 168) return true;
  // 198.18.0.0/15 (benchmarking)
  if (first === 198 && (second === 18 || second === 19)) return true;
  // 198.51.100.0/24 (TEST-NET-2)
  if (first === 198 && second === 51 && third === 100) return true;
  // 203.0.113.0/24 (TEST-NET-3)
  if (first === 203 && second === 0 && third === 113) return true;
  // 224.0.0.0/4 (multicast) & 240.0.0.0/4 (reserved/broadcast)
  if (first >= 224) return true;

  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const cleaned = ip.toLowerCase().split('%')[0];
  if (cleaned === '::' || cleaned === '::1') return true;

  // IPv4-mapped IPv6 e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1
  if (cleaned.startsWith('::ffff:')) {
    const rest = cleaned.slice(7);
    if (rest.includes('.')) {
      return isBlockedIpv4(rest);
    }
    const hexParts = rest.split(':');
    if (hexParts.length === 2) {
      const hi = parseInt(hexParts[0], 16);
      const lo = parseInt(hexParts[1], 16);
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
        return isBlockedIpv4(ipv4);
      }
    }
    return true;
  }

  // Expand first hextet
  const firstHextet = cleaned.split(':')[0] || '0';
  const firstNum = parseInt(firstHextet, 16);
  if (!Number.isFinite(firstNum)) return true;

  // fc00::/7 (Unique Local Address: fc00..fdff)
  if ((firstNum & 0xfe00) === 0xfc00) return true;
  // fe80::/10 (Link-local)
  if ((firstNum & 0xffc0) === 0xfe80) return true;
  // ff00::/8 (Multicast)
  if ((firstNum & 0xff00) === 0xff00) return true;

  return false;
}

export function isBlockedIpAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  return true;
}

export async function validateAndResolveExternalUrl(rawUrl: string): Promise<URL> {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed || trimmed.length > 2048) {
    throw new UnsafeUrlError('Please enter a valid http:// or https:// URL.');
  }

  // Block dangerous schemes explicitly before URL construction
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('file:') ||
    lower.startsWith('vbscript:')
  ) {
    throw new UnsafeUrlError('Only http:// and https:// URLs are allowed.');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new UnsafeUrlError('Please enter a valid http:// or https:// image URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UnsafeUrlError('Only http:// and https:// URLs are allowed.');
  }

  if (parsed.username || parsed.password) {
    throw new UnsafeUrlError('URLs containing embedded credentials are not allowed.');
  }

  const hostLower = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !hostLower ||
    hostLower === 'localhost' ||
    hostLower.endsWith('.localhost') ||
    hostLower.endsWith('.local') ||
    hostLower.endsWith('.internal') ||
    hostLower.endsWith('.arpa')
  ) {
    throw new UnsafeUrlError('Local or internal network addresses are not permitted.');
  }

  // Direct IP literal
  if (net.isIP(hostLower) !== 0) {
    if (isBlockedIpAddress(hostLower)) {
      throw new UnsafeUrlError('Private, loopback, or metadata IP addresses are not permitted.');
    }
    return parsed;
  }

  // Resolve DNS records and block any private/loopback/metadata resolution
  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.lookup(hostLower, { all: true, verbatim: true });
  } catch {
    throw new ImageFetchError("Couldn't load this image. Try another URL.", 422);
  }

  if (!addresses || addresses.length === 0) {
    throw new ImageFetchError("Couldn't load this image. Try another URL.", 422);
  }

  for (const record of addresses) {
    if (isBlockedIpAddress(record.address)) {
      throw new UnsafeUrlError('Private, loopback, or metadata IP addresses are not permitted.');
    }
  }

  return parsed;
}

function hasValidImageSignature(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 12) return false;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng =
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isGif = buffer.subarray(0, 4).toString('ascii') === 'GIF8';
  const isWebp =
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  const isTiff =
    (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
    (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a);
  const isAvif = buffer.subarray(4, 8).toString('ascii') === 'ftyp';
  return isJpeg || isPng || isGif || isWebp || isTiff || isAvif;
}

export interface FetchedSafeImage {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  format: string;
  width: number;
  height: number;
  sizeBytes: number;
  finalUrl: string;
}

export async function safeFetchExternalImage(
  rawUrl: string,
  maxBytes: number,
  timeoutMs = 12000
): Promise<FetchedSafeImage> {
  const MAX_REDIRECTS = 3;
  let currentUrl = await validateAndResolveExternalUrl(rawUrl);
  let response: globalThis.Response | null = null;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: globalThis.Response;
    try {
      res = await fetch(currentUrl.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Accept: 'image/webp,image/png,image/jpeg,image/gif,image/avif,image/*;q=0.8',
          'User-Agent': 'RIKZEN-ImageFetcher/1.0',
        },
      });
    } catch {
      throw new ImageFetchError("Couldn't load this image. Try another URL.", 422);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      try {
        await res.body?.cancel();
      } catch {
        // ignore cancel error
      }
      if (!location || hop === MAX_REDIRECTS) {
        throw new ImageFetchError("Couldn't load this image. Try another URL.", 422);
      }
      const nextRaw = new URL(location, currentUrl).toString();
      currentUrl = await validateAndResolveExternalUrl(nextRaw);
      continue;
    }

    if (!res.ok) {
      try {
        await res.body?.cancel();
      } catch {
        // ignore
      }
      throw new ImageFetchError("Couldn't load this image. Try another URL.", 422);
    }

    response = res;
    break;
  }

  if (!response) {
    throw new ImageFetchError("Couldn't load this image. Try another URL.", 422);
  }

  const contentTypeHeader = (response.headers.get('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase();

  // Reject clear non-image HTML/SVG/JSON responses upfront
  if (
    contentTypeHeader &&
    contentTypeHeader !== 'application/octet-stream' &&
    contentTypeHeader !== 'binary/octet-stream' &&
    !ALLOWED_IMAGE_MIMES.has(contentTypeHeader)
  ) {
    try {
      await response.body?.cancel();
    } catch {
      // ignore
    }
    throw new ImageFetchError("Couldn't load this image. Try another URL.", 422);
  }

  const declaredLen = Number(response.headers.get('content-length') || '0');
  if (Number.isFinite(declaredLen) && declaredLen > maxBytes) {
    try {
      await response.body?.cancel();
    } catch {
      // ignore
    }
    throw new ImageFetchError(
      `This image exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit.`,
      413
    );
  }

  const reader = response.body?.getReader();
  let buffer: Buffer;
  if (!reader) {
    const ab = await response.arrayBuffer();
    if (ab.byteLength > maxBytes) {
      throw new ImageFetchError(
        `This image exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit.`,
        413
      );
    }
    buffer = Buffer.from(ab);
  } else {
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel();
            throw new ImageFetchError(
              `This image exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit.`,
              413
            );
          }
          chunks.push(value);
        }
      }
    } catch (err) {
      if (err instanceof ImageFetchError) throw err;
      throw new ImageFetchError("Couldn't load this image. Try another URL.", 422);
    }
    buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  }

  // Never trust extension/content-type alone: inspect magic bytes + sharp metadata
  if (!hasValidImageSignature(buffer)) {
    throw new ImageFetchError("Couldn't load this image. Try another URL.", 422);
  }

  let meta: { format?: string; width?: number; height?: number };
  try {
    meta = await sharp(buffer, { failOn: 'error', limitInputPixels: 100_000_000 }).metadata();
  } catch {
    throw new ImageFetchError("Couldn't load this image. Try another URL.", 422);
  }

  const fmt = (meta.format || '').toLowerCase();
  if (!ALLOWED_SHARP_FORMATS.has(fmt) || !meta.width || !meta.height) {
    throw new ImageFetchError("Couldn't load this image. Try another URL.", 422);
  }

  const extMap: Record<string, { ext: string; mime: string }> = {
    jpeg: { ext: 'jpg', mime: 'image/jpeg' },
    png: { ext: 'png', mime: 'image/png' },
    webp: { ext: 'webp', mime: 'image/webp' },
    gif: { ext: 'gif', mime: 'image/gif' },
    avif: { ext: 'avif', mime: 'image/avif' },
    tiff: { ext: 'tiff', mime: 'image/tiff' },
  };
  const info = extMap[fmt] || { ext: 'jpg', mime: 'image/jpeg' };

  const urlPath = currentUrl.pathname.split('/').pop() || 'remote-image';
  const base = urlPath.replace(/\.[^.]+$/, '') || 'remote-image';
  const fileName = sanitizeFilename(`${base}.${info.ext}`, `remote-image.${info.ext}`);

  return {
    buffer,
    fileName,
    mimeType: info.mime,
    format: fmt === 'jpeg' ? 'JPG' : fmt.toUpperCase(),
    width: meta.width,
    height: meta.height,
    sizeBytes: buffer.length,
    finalUrl: currentUrl.toString(),
  };
}
