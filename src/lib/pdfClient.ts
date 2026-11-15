import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import JSZip from 'jszip';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import * as XLSX from 'xlsx';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

async function releasePdfProxy(pdf: pdfjsLib.PDFDocumentProxy | null) {
  if (!pdf) return;
  try {
    await pdf.cleanup();
  } catch {
    // Ignore cleanup errors
  }
  const maybeDestroy = (pdf as unknown as { destroy?: () => Promise<void> }).destroy;
  if (typeof maybeDestroy === 'function') {
    await maybeDestroy.call(pdf).catch(() => undefined);
  }
}

export interface RenderedPdfPage {
  pageNumber: number;
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
}

export interface PdfInspectionResult {
  pageCount: number;
  thumbnailDataUrl?: string;
}

function classifyPdfJsError(err: unknown, fileName: string): Error {
  const name = (err as { name?: string })?.name || '';
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (name === 'PasswordException' || msg.includes('password') || msg.includes('encrypted')) {
    return new Error(`"${fileName}" is password-protected.`);
  }
  return new Error(`"${fileName}" is corrupted or unreadable as a PDF.`);
}

export function parsePageRangeList(rangeStr: string, totalPages: number): number[] {
  const clean = rangeStr.trim().toLowerCase();
  if (!clean || clean === 'all') {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const result: number[] = [];
  const seen = new Set<number>();
  for (const part of clean.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (part.includes('-')) {
      const [aStr, bStr] = part.split('-');
      const a = Number(aStr);
      const b = Number(bStr);
      if (Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b >= a) {
        const end = Math.min(totalPages, b);
        for (let p = a; p <= end; p++) {
          if (!seen.has(p)) {
            seen.add(p);
            result.push(p);
          }
        }
      }
    } else {
      const p = Number(part);
      if (Number.isInteger(p) && p >= 1 && p <= totalPages && !seen.has(p)) {
        seen.add(p);
        result.push(p);
      }
    }
  }
  return result;
}

export async function inspectPdfFile(file: File, withThumb = true): Promise<PdfInspectionResult> {
  const buf = await file.arrayBuffer();
  let pdf: pdfjsLib.PDFDocumentProxy | null = null;
  try {
    pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const pageCount = pdf.numPages;
    let thumbnailDataUrl: string | undefined;

    if (withThumb && pageCount > 0) {
      const page = await pdf.getPage(1);
      try {
        const viewport = page.getViewport({ scale: 0.25 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.72);
        }
        canvas.width = 0;
        canvas.height = 0;
      } finally {
        page.cleanup();
      }
    }
    return { pageCount, thumbnailDataUrl };
  } catch (err) {
    throw classifyPdfJsError(err, file.name);
  } finally {
    await releasePdfProxy(pdf);
  }
}

export async function getPdfPageCount(file: File): Promise<number> {
  const info = await inspectPdfFile(file, false);
  return info.pageCount;
}

export interface PdfToImagesOptions {
  format: 'jpeg' | 'png' | 'webp';
  dpi?: 72 | 150 | 300;
  quality?: number; // 0.15 - 0.98
  pageRange?: string; // 'all' or '1-3, 5'
  includeDataUrls?: boolean;
  onProgress?: (done: number, total: number) => void;
}

export async function renderPdfToImages(
  file: File,
  formatOrOptions: 'jpeg' | 'png' | PdfToImagesOptions,
  legacyScale = 2,
  legacyOnProgress?: (done: number, total: number) => void
): Promise<{
  pages: RenderedPdfPage[];
  zipBlob: Blob;
  renderedPageCount: number;
  totalPdfPages: number;
}> {
  const opts: PdfToImagesOptions =
    typeof formatOrOptions === 'string'
      ? {
          format: formatOrOptions,
          dpi: legacyScale >= 3 ? 300 : legacyScale >= 1.8 ? 150 : 72,
          quality: 0.92,
          pageRange: 'all',
          includeDataUrls: true,
          onProgress: legacyOnProgress,
        }
      : formatOrOptions;

  const format = opts.format || 'jpeg';
  const dpi = opts.dpi || 150;
  const quality = Math.min(0.98, Math.max(0.15, opts.quality ?? 0.9));
  const includeDataUrls = opts.includeDataUrls !== false;

  const scale = dpi === 300 ? 3.2 : dpi === 150 ? 2.0 : 1.0;
  const mime = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
  const ext = format === 'png' ? 'png' : format === 'webp' ? 'webp' : 'jpg';

  const buf = await file.arrayBuffer();
  let pdf: pdfjsLib.PDFDocumentProxy | null = null;

  try {
    pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const totalPdfPages = pdf.numPages;
    const targetPages = parsePageRangeList(opts.pageRange || 'all', totalPdfPages);

    if (targetPages.length === 0) {
      throw new Error(`No valid pages matched "${opts.pageRange}" (PDF has ${totalPdfPages} pages).`);
    }

    const pages: RenderedPdfPage[] = [];
    const zip = new JSZip();

    for (let idx = 0; idx < targetPages.length; idx++) {
      const pageNum = targetPages[idx];
      const page = await pdf.getPage(pageNum);

      try {
        let viewport = page.getViewport({ scale });
        // Guard max canvas dimension (4096px) so huge architectural PDFs don't crash GPU canvas
        const maxDim = Math.max(viewport.width, viewport.height);
        if (maxDim > 3800) {
          viewport = page.getViewport({ scale: (scale * 3800) / maxDim });
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');

        if (format === 'jpeg') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        await page.render({ canvasContext: ctx, viewport, canvas }).promise;

        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Failed to encode image'))),
            mime,
            quality
          );
        });

        const dataUrl = includeDataUrls ? URL.createObjectURL(blob) : '';
        pages.push({
          pageNumber: pageNum,
          blob,
          dataUrl,
          width: canvas.width,
          height: canvas.height,
        });
        zip.file(`page-${String(pageNum).padStart(3, '0')}.${ext}`, blob);

        // Explicitly release canvas backing store immediately
        canvas.width = 0;
        canvas.height = 0;
      } finally {
        page.cleanup();
      }

      opts.onProgress?.(idx + 1, targetPages.length);
    }

    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    return {
      pages,
      zipBlob,
      renderedPageCount: targetPages.length,
      totalPdfPages,
    };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('No valid pages')) throw err;
    throw classifyPdfJsError(err, file.name);
  } finally {
    await releasePdfProxy(pdf);
  }
}

export async function renderPdfThumbnails(file: File, maxPages = 40): Promise<RenderedPdfPage[]> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  try {
    const count = Math.min(pdf.numPages, maxPages);
    const thumbs: RenderedPdfPage[] = [];

    for (let i = 1; i <= count; i++) {
      const page = await pdf.getPage(i);
      try {
        const viewport = page.getViewport({ scale: 0.45 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        thumbs.push({
          pageNumber: i,
          blob: new Blob(),
          dataUrl,
          width: canvas.width,
          height: canvas.height,
        });
        canvas.width = 0;
        canvas.height = 0;
      } finally {
        page.cleanup();
      }
    }
    return thumbs;
  } finally {
    await releasePdfProxy(pdf);
  }
}

export async function extractPdfTextPages(file: File): Promise<{ pageNumber: number; text: string }[]> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  try {
    const pages: { pageNumber: number; text: string }[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      try {
        const content = await page.getTextContent();
        const lines: string[] = [];
        let currentLine = '';
        let lastY: number | null = null;

        for (const item of content.items) {
          if (!('str' in item)) continue;
          const y = Array.isArray(item.transform) ? Math.round(item.transform[5]) : 0;
          if (lastY !== null && Math.abs(y - lastY) > 4) {
            if (currentLine.trim()) lines.push(currentLine.trim());
            currentLine = item.str;
          } else {
            currentLine +=
              (currentLine && !currentLine.endsWith(' ') && !item.str.startsWith(' ') ? ' ' : '') +
              item.str;
          }
          lastY = y;
        }
        if (currentLine.trim()) lines.push(currentLine.trim());
        pages.push({ pageNumber: i, text: lines.join('\n') });
      } finally {
        page.cleanup();
      }
    }

    return pages;
  } finally {
    await releasePdfProxy(pdf);
  }
}

export async function convertPdfToDocxBlob(file: File): Promise<Blob> {
  const pages = await extractPdfTextPages(file);
  const children: Paragraph[] = [];

  pages.forEach((p, idx) => {
    if (idx > 0) {
      children.push(new Paragraph({ text: '', pageBreakBefore: true }));
    }
    const lines = p.text.split('\n');
    for (const line of lines) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: line, size: 22 })],
          spacing: { after: 120 },
        })
      );
    }
  });

  if (children.length === 0) {
    children.push(new Paragraph({ text: '(No selectable text found in PDF)' }));
  }

  const doc = new Document({
    sections: [{ children }],
  });

  return await Packer.toBlob(doc);
}

export async function convertPdfToExcelBlob(file: File): Promise<Blob> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  try {
    const wb = XLSX.utils.book_new();

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      try {
        const content = await page.getTextContent();

        interface CellToken {
          x: number;
          y: number;
          str: string;
        }

        const tokens: CellToken[] = [];
        for (const item of content.items) {
          if (!('str' in item) || !item.str.trim()) continue;
          const x = Array.isArray(item.transform) ? Math.round(item.transform[4]) : 0;
          const y = Array.isArray(item.transform) ? Math.round(item.transform[5]) : 0;
          tokens.push({ x, y, str: item.str.trim() });
        }

        tokens.sort((a, b) => b.y - a.y || a.x - b.x);
        const rows: string[][] = [];
        let currentRowTokens: CellToken[] = [];
        let anchorY: number | null = null;

        for (const t of tokens) {
          if (anchorY === null || Math.abs(t.y - anchorY) <= 5) {
            currentRowTokens.push(t);
            if (anchorY === null) anchorY = t.y;
          } else {
            currentRowTokens.sort((a, b) => a.x - b.x);
            rows.push(currentRowTokens.map((c) => c.str));
            currentRowTokens = [t];
            anchorY = t.y;
          }
        }
        if (currentRowTokens.length > 0) {
          currentRowTokens.sort((a, b) => a.x - b.x);
          rows.push(currentRowTokens.map((c) => c.str));
        }

        const sheet = XLSX.utils.aoa_to_sheet(rows.length ? rows : [['No selectable text found']]);
        XLSX.utils.book_append_sheet(wb, sheet, `Page ${i}`);
      } finally {
        page.cleanup();
      }
    }

    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  } finally {
    await releasePdfProxy(pdf);
  }
}

export async function renderPdfPreviewPages(
  blob: Blob,
  maxPages = 8
): Promise<{ totalPages: number; pages: { pageNumber: number; dataUrl: string }[] }> {
  const buf = await blob.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  try {
    const totalPages = pdf.numPages;
    const limit = Math.min(totalPages, maxPages);
    const pages: { pageNumber: number; dataUrl: string }[] = [];

    for (let i = 1; i <= limit; i++) {
      const page = await pdf.getPage(i);
      try {
        const viewport = page.getViewport({ scale: 1.15 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          pages.push({ pageNumber: i, dataUrl: canvas.toDataURL('image/jpeg', 0.85) });
        }
        canvas.width = 0;
        canvas.height = 0;
      } finally {
        page.cleanup();
      }
    }

    return { totalPages, pages };
  } finally {
    await releasePdfProxy(pdf);
  }
}
