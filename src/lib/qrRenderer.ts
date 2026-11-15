import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';

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

export type QrTemplateId = 'classic' | 'rikzen' | 'premium' | 'minimal' | 'photo' | 'video';

export interface QrDesignConfig {
  template: QrTemplateId;
  fgColor: string;
  bgColor: string;
  transparentBg: boolean;
  moduleStyle: 'square' | 'rounded';
  eyeStyle: 'square' | 'rounded';
  logoMode: 'none' | 'rikzen' | 'photo' | 'video';
  resolution: 512 | 1024 | 2048;
}

export interface QrTemplatePreset {
  id: QrTemplateId;
  label: string;
  design: Partial<QrDesignConfig>;
}

export const QR_TEMPLATES: QrTemplatePreset[] = [
  {
    id: 'classic',
    label: 'Classic',
    design: {
      template: 'classic',
      fgColor: '#0B0C0E',
      bgColor: '#FFFFFF',
      transparentBg: false,
      moduleStyle: 'square',
      eyeStyle: 'square',
      logoMode: 'none',
    },
  },
  {
    id: 'rikzen',
    label: 'RIKZEN',
    design: {
      template: 'rikzen',
      fgColor: '#111214',
      bgColor: '#FFFDF7',
      transparentBg: false,
      moduleStyle: 'rounded',
      eyeStyle: 'rounded',
      logoMode: 'rikzen',
    },
  },
  {
    id: 'premium',
    label: 'Premium',
    design: {
      template: 'premium',
      fgColor: '#D4AF37',
      bgColor: '#0B0C0E',
      transparentBg: false,
      moduleStyle: 'rounded',
      eyeStyle: 'rounded',
      logoMode: 'rikzen',
    },
  },
  {
    id: 'minimal',
    label: 'Minimal',
    design: {
      template: 'minimal',
      fgColor: '#1E222B',
      bgColor: '#FFFFFF',
      transparentBg: false,
      moduleStyle: 'square',
      eyeStyle: 'rounded',
      logoMode: 'none',
    },
  },
  {
    id: 'photo',
    label: 'Photo',
    design: {
      template: 'photo',
      fgColor: '#111214',
      bgColor: '#FFFFFF',
      transparentBg: false,
      moduleStyle: 'rounded',
      eyeStyle: 'rounded',
      logoMode: 'photo',
    },
  },
  {
    id: 'video',
    label: 'Video',
    design: {
      template: 'video',
      fgColor: '#111214',
      bgColor: '#FFFFFF',
      transparentBg: false,
      moduleStyle: 'rounded',
      eyeStyle: 'rounded',
      logoMode: 'video',
    },
  },
];

export const DEFAULT_QR_DESIGN: QrDesignConfig = {
  template: 'classic',
  fgColor: '#0B0C0E',
  bgColor: '#FFFFFF',
  transparentBg: false,
  moduleStyle: 'square',
  eyeStyle: 'square',
  logoMode: 'none',
  resolution: 1024,
};

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return Number.isNaN(r) ? null : { r, g, b };
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return Number.isNaN(r) ? null : { r, g, b };
  }
  return null;
}

function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const [rs, gs, bs] = [rgb.r / 255, rgb.g / 255, rgb.b / 255].map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export function getContrastRatio(fgHex: string, bgHex: string): number {
  const fg = hexToRgb(fgHex);
  const bg = hexToRgb(bgHex);
  if (!fg || !bg) return 10;
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function isFinderModule(row: number, col: number, count: number): boolean {
  const topLeft = row < 7 && col < 7;
  const topRight = row < 7 && col >= count - 7;
  const bottomLeft = row >= count - 7 && col < 7;
  return topLeft || topRight || bottomLeft;
}

function isLogoClearedModule(
  row: number,
  col: number,
  count: number,
  logoMode: QrDesignConfig['logoMode']
): boolean {
  if (logoMode === 'none') return false;
  const center = (count - 1) / 2;
  const clearRadius = Math.max(2.6, count * 0.125);
  return Math.abs(row - center) <= clearRadius && Math.abs(col - center) <= clearRadius;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function getEyeColor(design: QrDesignConfig): string {
  if (design.template === 'rikzen') return '#B88E1E';
  return design.fgColor;
}

function drawCenterLogoCanvas(
  ctx: CanvasRenderingContext2D,
  size: number,
  design: QrDesignConfig
) {
  if (design.logoMode === 'none') return;
  const badgeSize = size * 0.19;
  const cx = size / 2;
  const cy = size / 2;
  const bx = cx - badgeSize / 2;
  const by = cy - badgeSize / 2;

  const badgeBg = design.transparentBg ? '#FFFFFF' : design.bgColor;
  ctx.fillStyle = badgeBg;
  drawRoundedRect(ctx, bx - badgeSize * 0.1, by - badgeSize * 0.1, badgeSize * 1.2, badgeSize * 1.2, badgeSize * 0.28);
  ctx.fill();

  const fillCol = design.template === 'premium' ? '#D4AF37' : '#111214';
  const accentCol = design.template === 'premium' ? '#0B0C0E' : '#D4AF37';

  ctx.fillStyle = fillCol;
  drawRoundedRect(ctx, bx, by, badgeSize, badgeSize, badgeSize * 0.22);
  ctx.fill();

  ctx.strokeStyle = '#C9A227';
  ctx.lineWidth = Math.max(2, size * 0.004);
  drawRoundedRect(ctx, bx, by, badgeSize, badgeSize, badgeSize * 0.22);
  ctx.stroke();

  if (design.logoMode === 'rikzen') {
    ctx.fillStyle = accentCol;
    ctx.font = `800 ${Math.round(badgeSize * 0.56)}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('R', cx, cy + badgeSize * 0.04);
  } else if (design.logoMode === 'video') {
    // Crisp play triangle
    ctx.fillStyle = accentCol;
    const p = badgeSize * 0.24;
    ctx.beginPath();
    ctx.moveTo(cx - p * 0.65, cy - p);
    ctx.lineTo(cx + p * 1.05, cy);
    ctx.lineTo(cx - p * 0.65, cy + p);
    ctx.closePath();
    ctx.fill();
  } else if (design.logoMode === 'photo') {
    // Crisp camera frame glyph
    const w = badgeSize * 0.54;
    const h = badgeSize * 0.4;
    ctx.strokeStyle = accentCol;
    ctx.lineWidth = Math.max(2, badgeSize * 0.08);
    drawRoundedRect(ctx, cx - w / 2, cy - h / 2, w, h, badgeSize * 0.08);
    ctx.stroke();
    ctx.fillStyle = accentCol;
    ctx.beginPath();
    ctx.arc(cx, cy, badgeSize * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }
}

export interface RenderedQrResult {
  dataUrl: string;
  svgString: string;
  scannable: boolean;
  contrastRatio: number;
  lowContrast: boolean;
}

export function renderStyledQr(
  payload: string,
  design: QrDesignConfig,
  renderSize: number = design.resolution
): RenderedQrResult {
  const safePayload = payload.trim() || 'https://rikzen.tools';
  const ecc: 'M' | 'H' =
    design.logoMode !== 'none' || design.moduleStyle === 'rounded' ? 'H' : 'M';

  const qr = QRCode.create(safePayload, { errorCorrectionLevel: ecc });
  const count = qr.modules.size;
  const data = qr.modules.data;

  const marginModules = 3;
  const totalModules = count + marginModules * 2;
  const cell = renderSize / totalModules;

  const canvas = document.createElement('canvas');
  canvas.width = renderSize;
  canvas.height = renderSize;
  const ctx = canvas.getContext('2d')!;

  if (!design.transparentBg) {
    ctx.fillStyle = design.bgColor;
    ctx.fillRect(0, 0, renderSize, renderSize);
  } else {
    ctx.clearRect(0, 0, renderSize, renderSize);
  }

  // Draw data modules
  ctx.fillStyle = design.fgColor;
  const gap = design.moduleStyle === 'rounded' ? cell * 0.12 : 0;
  const modSize = cell - gap;

  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (!data[r * count + c]) continue;
      if (isFinderModule(r, c, count)) continue;
      if (isLogoClearedModule(r, c, count, design.logoMode)) continue;

      const x = (c + marginModules) * cell + gap / 2;
      const y = (r + marginModules) * cell + gap / 2;

      if (design.moduleStyle === 'rounded') {
        drawRoundedRect(ctx, x, y, modSize, modSize, modSize * 0.34);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, Math.ceil(cell), Math.ceil(cell));
      }
    }
  }

  // Draw 3 finder eyes explicitly for clean Square or Rounded geometry
  const eyeCoords = [
    { r: 0, c: 0 },
    { r: 0, c: count - 7 },
    { r: count - 7, c: 0 },
  ];
  const eyeColor = getEyeColor(design);
  const bgClearColor = design.transparentBg ? null : design.bgColor;

  for (const eye of eyeCoords) {
    const ex = (eye.c + marginModules) * cell;
    const ey = (eye.r + marginModules) * cell;
    const outer = 7 * cell;
    const mid = 5 * cell;
    const inner = 3 * cell;

    ctx.fillStyle = eyeColor;
    if (design.eyeStyle === 'rounded') {
      drawRoundedRect(ctx, ex, ey, outer, outer, cell * 1.9);
      ctx.fill();
    } else {
      ctx.fillRect(ex, ey, outer, outer);
    }

    if (bgClearColor) {
      ctx.fillStyle = bgClearColor;
      if (design.eyeStyle === 'rounded') {
        drawRoundedRect(ctx, ex + cell, ey + cell, mid, mid, cell * 1.25);
        ctx.fill();
      } else {
        ctx.fillRect(ex + cell, ey + cell, mid, mid);
      }
    } else {
      ctx.clearRect(ex + cell, ey + cell, mid, mid);
    }

    ctx.fillStyle = eyeColor;
    if (design.eyeStyle === 'rounded') {
      drawRoundedRect(ctx, ex + 2 * cell, ey + 2 * cell, inner, inner, cell * 0.85);
      ctx.fill();
    } else {
      ctx.fillRect(ex + 2 * cell, ey + 2 * cell, inner, inner);
    }
  }

  drawCenterLogoCanvas(ctx, renderSize, design);

  // Real scannability validation via jsQR on an opaque white-backed check surface
  let scannable = true;
  try {
    const verifySize = Math.min(480, renderSize);
    const vCanvas = document.createElement('canvas');
    vCanvas.width = verifySize;
    vCanvas.height = verifySize;
    const vCtx = vCanvas.getContext('2d');
    if (vCtx) {
      if (design.transparentBg) {
        vCtx.fillStyle = '#FFFFFF';
        vCtx.fillRect(0, 0, verifySize, verifySize);
      }
      vCtx.drawImage(canvas, 0, 0, verifySize, verifySize);
      const imgData = vCtx.getImageData(0, 0, verifySize, verifySize);
      const decoded = jsQR(imgData.data, verifySize, verifySize, {
        inversionAttempts: 'attemptBoth',
      });
      scannable = Boolean(decoded && decoded.data === safePayload);
    }
  } catch {
    scannable = true;
  }

  const svgString = buildStyledQrSvg(safePayload, count, data, design);
  const contrastRatio = design.transparentBg ? 10 : getContrastRatio(design.fgColor, design.bgColor);

  return {
    dataUrl: canvas.toDataURL('image/png'),
    svgString,
    scannable,
    contrastRatio,
    lowContrast: !design.transparentBg && contrastRatio < 3.0,
  };
}

function buildStyledQrSvg(
  _payload: string,
  count: number,
  data: Uint8Array,
  design: QrDesignConfig
): string {
  const margin = 3;
  const total = count + margin * 2;
  const size = 1000;
  const cell = size / total;
  const gap = design.moduleStyle === 'rounded' ? cell * 0.12 : 0;
  const mod = cell - gap;
  const rx = design.moduleStyle === 'rounded' ? (mod * 0.34).toFixed(2) : '0';
  const eyeColor = getEyeColor(design);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="geometricPrecision">`
  );
  if (!design.transparentBg) {
    parts.push(`<rect width="${size}" height="${size}" fill="${design.bgColor}"/>`);
  }

  const moduleRects: string[] = [];
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (!data[r * count + c]) continue;
      if (isFinderModule(r, c, count)) continue;
      if (isLogoClearedModule(r, c, count, design.logoMode)) continue;
      const x = ((c + margin) * cell + gap / 2).toFixed(2);
      const y = ((r + margin) * cell + gap / 2).toFixed(2);
      moduleRects.push(
        `<rect x="${x}" y="${y}" width="${mod.toFixed(2)}" height="${mod.toFixed(2)}" rx="${rx}"/>`
      );
    }
  }
  parts.push(`<g fill="${design.fgColor}">${moduleRects.join('')}</g>`);

  const eyeCoords = [
    { r: 0, c: 0 },
    { r: 0, c: count - 7 },
    { r: count - 7, c: 0 },
  ];
  const outerR = design.eyeStyle === 'rounded' ? (cell * 1.9).toFixed(2) : '0';
  const midR = design.eyeStyle === 'rounded' ? (cell * 1.25).toFixed(2) : '0';
  const innerR = design.eyeStyle === 'rounded' ? (cell * 0.85).toFixed(2) : '0';
  const holeFill = design.transparentBg ? '#FFFFFF' : design.bgColor;

  for (const eye of eyeCoords) {
    const ex = (eye.c + margin) * cell;
    const ey = (eye.r + margin) * cell;
    parts.push(
      `<rect x="${ex.toFixed(2)}" y="${ey.toFixed(2)}" width="${(7 * cell).toFixed(2)}" height="${(7 * cell).toFixed(2)}" rx="${outerR}" fill="${eyeColor}"/>`,
      `<rect x="${(ex + cell).toFixed(2)}" y="${(ey + cell).toFixed(2)}" width="${(5 * cell).toFixed(2)}" height="${(5 * cell).toFixed(2)}" rx="${midR}" fill="${holeFill}"/>`,
      `<rect x="${(ex + 2 * cell).toFixed(2)}" y="${(ey + 2 * cell).toFixed(2)}" width="${(3 * cell).toFixed(2)}" height="${(3 * cell).toFixed(2)}" rx="${innerR}" fill="${eyeColor}"/>`
    );
  }

  if (design.logoMode !== 'none') {
    const badge = size * 0.19;
    const cx = size / 2;
    const cy = size / 2;
    const bx = cx - badge / 2;
    const by = cy - badge / 2;
    const pad = badge * 0.1;
    const fillCol = design.template === 'premium' ? '#D4AF37' : '#111214';
    const accentCol = design.template === 'premium' ? '#0B0C0E' : '#D4AF37';
    parts.push(
      `<rect x="${(bx - pad).toFixed(1)}" y="${(by - pad).toFixed(1)}" width="${(badge + pad * 2).toFixed(1)}" height="${(badge + pad * 2).toFixed(1)}" rx="${(badge * 0.28).toFixed(1)}" fill="${holeFill}"/>`,
      `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${badge.toFixed(1)}" height="${badge.toFixed(1)}" rx="${(badge * 0.22).toFixed(1)}" fill="${fillCol}" stroke="#C9A227" stroke-width="4"/>`
    );
    if (design.logoMode === 'rikzen') {
      parts.push(
        `<text x="${cx}" y="${cy + badge * 0.18}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-weight="800" font-size="${(badge * 0.56).toFixed(1)}" fill="${accentCol}">R</text>`
      );
    } else if (design.logoMode === 'video') {
      const p = badge * 0.24;
      parts.push(
        `<polygon points="${(cx - p * 0.65).toFixed(1)},${(cy - p).toFixed(1)} ${(cx + p * 1.05).toFixed(1)},${cy.toFixed(1)} ${(cx - p * 0.65).toFixed(1)},${(cy + p).toFixed(1)}" fill="${accentCol}"/>`
      );
    } else if (design.logoMode === 'photo') {
      const w = badge * 0.54;
      const h = badge * 0.4;
      parts.push(
        `<rect x="${(cx - w / 2).toFixed(1)}" y="${(cy - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${(badge * 0.08).toFixed(1)}" fill="none" stroke="${accentCol}" stroke-width="${(badge * 0.08).toFixed(1)}"/>`,
        `<circle cx="${cx}" cy="${cy}" r="${(badge * 0.1).toFixed(1)}" fill="${accentCol}"/>`
      );
    }
  }

  parts.push('</svg>');
  return parts.join('');
}

export async function renderQrPngBlob(
  payload: string,
  design: QrDesignConfig,
  resolution: 512 | 1024 | 2048 = design.resolution
): Promise<{ blob: Blob; dataUrl: string; scannable: boolean }> {
  const rendered = renderStyledQr(payload, design, resolution);
  const res = await fetch(rendered.dataUrl);
  const blob = await res.blob();
  return { blob, dataUrl: rendered.dataUrl, scannable: rendered.scannable };
}

export function buildQrPayloadFromForm(
  qrType: QrContentType,
  fields: {
    url?: string;
    text?: string;
    contactName?: string;
    contactPhone?: string;
    contactEmail?: string;
    contactOrg?: string;
    contactUrl?: string;
    wifiSsid?: string;
    wifiPassword?: string;
    wifiSecurity?: 'WPA' | 'WEP' | 'nopass';
    wifiHidden?: boolean;
    emailTo?: string;
    emailSubject?: string;
    emailBody?: string;
    phoneNumber?: string;
    lat?: string;
    lng?: string;
  }
): string {
  switch (qrType) {
    case 'link': {
      const raw = (fields.url || '').trim();
      if (!raw) return '';
      return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    }
    case 'text':
      return (fields.text || '').trim();
    case 'contact': {
      const fn = (fields.contactName || '').trim();
      if (!fn) return '';
      const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${fn}`];
      if (fields.contactOrg?.trim()) lines.push(`ORG:${fields.contactOrg.trim()}`);
      if (fields.contactPhone?.trim()) lines.push(`TEL:${fields.contactPhone.trim()}`);
      if (fields.contactEmail?.trim()) lines.push(`EMAIL:${fields.contactEmail.trim()}`);
      if (fields.contactUrl?.trim()) lines.push(`URL:${fields.contactUrl.trim()}`);
      lines.push('END:VCARD');
      return lines.join('\n');
    }
    case 'wifi': {
      const ssid = (fields.wifiSsid || '').trim();
      if (!ssid) return '';
      const esc = (s: string) => s.replace(/([\\;,:"])/g, '\\$1');
      const sec = fields.wifiSecurity || 'WPA';
      const pass = sec === 'nopass' ? '' : fields.wifiPassword || '';
      const hidden = fields.wifiHidden ? 'true' : 'false';
      return `WIFI:T:${sec};S:${esc(ssid)};P:${esc(pass)};H:${hidden};;`;
    }
    case 'email': {
      const to = (fields.emailTo || '').trim();
      if (!to) return '';
      const params = new URLSearchParams();
      if (fields.emailSubject?.trim()) params.set('subject', fields.emailSubject.trim());
      if (fields.emailBody?.trim()) params.set('body', fields.emailBody.trim());
      const q = params.toString();
      return q ? `mailto:${to}?${q}` : `mailto:${to}`;
    }
    case 'phone': {
      const tel = (fields.phoneNumber || '').trim();
      return tel ? `tel:${tel}` : '';
    }
    case 'location': {
      const lat = (fields.lat || '').trim();
      const lng = (fields.lng || '').trim();
      return lat && lng ? `geo:${lat},${lng}` : '';
    }
    default:
      return '';
  }
}

export async function captureVideoMetadataClient(file: File): Promise<{
  durationSec: number | null;
  width: number | null;
  height: number | null;
  thumbnailBlob: Blob | null;
  thumbnailDataUrl: string | null;
}> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    let finished = false;
    const finish = (
      durationSec: number | null,
      width: number | null,
      height: number | null,
      thumbnailBlob: Blob | null,
      thumbnailDataUrl: string | null
    ) => {
      if (finished) return;
      finished = true;
      URL.revokeObjectURL(url);
      resolve({ durationSec, width, height, thumbnailBlob, thumbnailDataUrl });
    };

    const timeout = window.setTimeout(() => finish(null, null, null, null, null), 6000);

    video.onloadeddata = () => {
      const dur = Number.isFinite(video.duration) ? Math.round(video.duration * 10) / 10 : null;
      const w = video.videoWidth || null;
      const h = video.videoHeight || null;
      video.currentTime = Math.min(0.6, (video.duration || 1) / 3);

      video.onseeked = () => {
        window.clearTimeout(timeout);
        try {
          const canvas = document.createElement('canvas');
          const scale = Math.min(1, 640 / Math.max(1, video.videoWidth || 640));
          canvas.width = Math.max(1, Math.round((video.videoWidth || 640) * scale));
          canvas.height = Math.max(1, Math.round((video.videoHeight || 360) * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            finish(dur, w, h, null, null);
            return;
          }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          canvas.toBlob(
            (blob) => finish(dur, w, h, blob, dataUrl),
            'image/jpeg',
            0.82
          );
        } catch {
          finish(dur, w, h, null, null);
        }
      };
    };

    video.onerror = () => {
      window.clearTimeout(timeout);
      finish(null, null, null, null, null);
    };

    video.src = url;
  });
}

export async function syncQrToFirestore(params: {
  userId: string;
  shareId: string;
  name: string;
  qrType: QrContentType;
  payload: string;
  shareUrl: string;
  mimeType?: string | null;
  fileName?: string | null;
  sizeBytes?: number;
  thumbnailUrl?: string | null;
  design?: QrDesignConfig;
  expiresAt?: number | null;
}) {
  try {
    const docRef = doc(db, 'qr_codes', params.shareId);
    const data: Record<string, unknown> = {
      id: params.shareId,
      userId: params.userId,
      shareId: params.shareId,
      name: params.name.slice(0, 140),
      qrType: params.qrType,
      payload: params.payload.slice(0, 4000),
      shareUrl: params.shareUrl.slice(0, 1000),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (params.mimeType) data.mimeType = params.mimeType.slice(0, 120);
    if (params.fileName) data.fileName = params.fileName.slice(0, 255);
    if (typeof params.sizeBytes === 'number') data.sizeBytes = params.sizeBytes;
    if (params.thumbnailUrl) data.thumbnailUrl = params.thumbnailUrl.slice(0, 1000);
    if (params.design) data.designJson = JSON.stringify(params.design).slice(0, 4000);
    if (typeof params.expiresAt === 'number' && params.expiresAt > 0) {
      data.expiresAtMs = params.expiresAt;
    }
    await setDoc(docRef, data);
  } catch (err) {
    console.warn('Firestore qr_codes sync skipped:', err);
  }
}
