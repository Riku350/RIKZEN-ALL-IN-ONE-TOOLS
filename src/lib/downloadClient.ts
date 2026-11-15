export type DownloadFailureCode = 'EXPIRED' | 'INVALID' | 'FAILED';

export class DownloadError extends Error {
  code: DownloadFailureCode;

  constructor(message: string, code: DownloadFailureCode = 'FAILED') {
    super(message);
    this.name = 'DownloadError';
    this.code = code;
  }
}

export function extractSecureTokenFromUrl(url?: string): string | null {
  if (!url) return null;
  const match = /\/api\/download\/([^/?#]+)/.exec(url);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function triggerBlobSave(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = fileName || 'rikzen-download';
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Delay revocation slightly so mobile Chrome completes reading the Blob URL
  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 4000);
}

export async function fetchFileAsBlob(params: {
  url: string;
  mimeType?: string;
  blob?: Blob;
  headers?: Record<string, string>;
}): Promise<Blob> {
  if (params.blob) {
    return params.blob;
  }

  const { url, mimeType, headers } = params;
  if (!url) {
    throw new DownloadError('Download link is unavailable.', 'FAILED');
  }

  // Local object / data URLs never touch the network
  if (url.startsWith('blob:') || url.startsWith('data:')) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new DownloadError('This file is no longer available in memory.', 'EXPIRED');
    }
    const raw = await res.blob();
    return mimeType && !raw.type ? new Blob([raw], { type: mimeType }) : raw;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers,
    });
  } catch {
    throw new DownloadError('Connection interrupted. Please try again.', 'FAILED');
  }

  const contentType = (res.headers.get('content-type') || '').toLowerCase();

  if (!res.ok) {
    let errCode: string | undefined;
    if (contentType.includes('application/json')) {
      try {
        const body = (await res.json()) as { code?: string };
        errCode = body?.code;
      } catch {
        // ignore JSON parse issues
      }
    }
    if (res.status === 410 || res.status === 404 || errCode === 'FILE_EXPIRED') {
      throw new DownloadError('This file has expired.', 'EXPIRED');
    }
    if (res.status === 403 || errCode === 'INVALID_DOWNLOAD_TOKEN') {
      throw new DownloadError('Download link is invalid or expired.', 'INVALID');
    }
    throw new DownloadError('Download failed. Please try again.', 'FAILED');
  }

  // Guard against reverse-proxy HTML interstitials masquerading as a binary file
  const expectsHtml = Boolean(mimeType && mimeType.toLowerCase().includes('text/html'));
  if (!expectsHtml && contentType.includes('text/html')) {
    throw new DownloadError('Could not retrieve the file safely. Please try again.', 'FAILED');
  }

  const rawBlob = await res.blob();
  const resolvedType = mimeType || rawBlob.type || contentType.split(';')[0] || 'application/octet-stream';
  return rawBlob.type === resolvedType ? rawBlob : new Blob([rawBlob], { type: resolvedType });
}

export async function downloadFileSafely(params: {
  url: string;
  fileName: string;
  mimeType?: string;
  blob?: Blob;
  headers?: Record<string, string>;
}): Promise<Blob> {
  const fileBlob = await fetchFileAsBlob({
    url: params.url,
    mimeType: params.mimeType,
    blob: params.blob,
    headers: params.headers,
  });
  triggerBlobSave(fileBlob, params.fileName);
  return fileBlob;
}
