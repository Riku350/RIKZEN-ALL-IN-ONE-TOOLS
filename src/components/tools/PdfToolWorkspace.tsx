import React, { useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Copy,
  Download,
  Eye,
  FileText,
  GripVertical,
  Loader2,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { ToolDefinition } from '../../lib/toolRegistry';
import { SelectedUploadItem, UploadZone } from '../UploadZone';
import { ImageUrlLoader, LoadedUrlImage } from '../ImageUrlLoader';
import { ProcessedResult, ToolResultCard } from './ToolResultCard';
import { BatchJobItem, BatchStatusTable } from './BatchStatusTable';
import { useAuth } from '../../contexts/AuthContext';
import { useApp } from '../../contexts/AppContext';
import {
  convertPdfToDocxBlob,
  convertPdfToExcelBlob,
  extractPdfTextPages,
  getPdfPageCount,
  inspectPdfFile,
  RenderedPdfPage,
  renderPdfThumbnails,
  renderPdfToImages,
} from '../../lib/pdfClient';
import { formatBytes, logClientToolExecution, trackAnalyticsEvent } from '../../lib/formatters';
import {
  downloadFileSafely,
  extractSecureTokenFromUrl,
  triggerBlobSave,
} from '../../lib/downloadClient';

interface ImagePdfEntry {
  id: string;
  file: File;
  previewUrl: string;
  rotation: number; // 0 | 90 | 180 | 270
}

interface BatchPdfCompressEntry extends BatchJobItem {
  file: File;
  fileId?: string;
  downloadToken?: string;
  secureToken?: string;
}

interface MergePdfEntry {
  id: string;
  file: File;
  pageCount: number | null;
  status: 'checking' | 'ready' | 'error';
  errorText?: string;
}

interface BatchPdfRenderEntry extends BatchJobItem {
  file: File;
  pageCount: number | null;
  zipBlob?: Blob;
  renderedPages?: RenderedPdfPage[];
}

export const PdfToolWorkspace: React.FC<{ tool: ToolDefinition }> = ({ tool }) => {
  const { getToken } = useAuth();
  const { t, capabilities, toolConfigs, notify } = useApp();

  const [files, setFiles] = useState<SelectedUploadItem[]>([]);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [splitMode, setSplitMode] = useState<'range' | 'all-zip'>('range');
  const [pageRanges, setPageRanges] = useState('1');
  const [rotateAngle, setRotateAngle] = useState(90);
  const [rotatePages, setRotatePages] = useState('all');

  // JPG -> PDF upgraded controls
  const [imgEntries, setImgEntries] = useState<ImagePdfEntry[]>([]);
  const [jpgToPdfSize, setJpgToPdfSize] = useState<'a4' | 'letter' | 'fit'>('a4');
  const [jpgToPdfOrientation, setJpgToPdfOrientation] = useState<'auto' | 'portrait' | 'landscape'>('auto');
  const [jpgToPdfMargin, setJpgToPdfMargin] = useState<'none' | 'small' | 'normal'>('small');
  const [jpgToPdfFit, setJpgToPdfFit] = useState<'contain' | 'cover' | 'stretch'>('contain');
  const [previewImgItem, setPreviewImgItem] = useState<ImagePdfEntry | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // Merge PDF upgraded controls
  const [mergeEntries, setMergeEntries] = useState<MergePdfEntry[]>([]);
  const [mergeDragIdx, setMergeDragIdx] = useState<number | null>(null);

  // Batch PDF -> Images controls
  const isPdfToImagesTool =
    tool.id === 'pdf-to-images' || tool.id === 'pdf-to-jpg' || tool.id === 'pdf-to-png';
  const [pdfImgEntries, setPdfImgEntries] = useState<BatchPdfRenderEntry[]>([]);
  const [pdfImgFormat, setPdfImgFormat] = useState<'jpeg' | 'png' | 'webp'>(
    tool.id === 'pdf-to-png' ? 'png' : 'jpeg'
  );
  const [pdfImgDpi, setPdfImgDpi] = useState<72 | 150 | 300>(150);
  const [pdfImgQuality, setPdfImgQuality] = useState(90);
  const [pdfImgPageMode, setPdfImgPageMode] = useState<'all' | 'custom'>('all');
  const [pdfImgPageRange, setPdfImgPageRange] = useState('1-3');
  const [batchZipBusy, setBatchZipBusy] = useState(false);
  const [singlePdfPages, setSinglePdfPages] = useState<RenderedPdfPage[]>([]);

  // Reorder pages state
  const [thumbnails, setThumbnails] = useState<RenderedPdfPage[]>([]);
  const [pageOrder, setPageOrder] = useState<number[]>([]);
  const [loadingThumbs, setLoadingThumbs] = useState(false);

  // Text extraction
  const [extractedText, setExtractedText] = useState<string | null>(null);

  const [jpgSourceMode, setJpgSourceMode] = useState<'upload' | 'url'>('upload');
  const [compressBatchEntries, setCompressBatchEntries] = useState<BatchPdfCompressEntry[]>([]);

  const [processing, setProcessing] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProcessedResult | null>(null);
  const [clientObjectUrl, setClientObjectUrl] = useState<string | null>(null);
  const objectUrlsRef = useRef<string[]>([]);

  const maxSizeMb = toolConfigs[tool.id]?.maxFileSizeMb || tool.maxSizeMb || capabilities.maxFileSizeMb || 100;
  const maxBatchFiles = capabilities.maxFilesPerBatch || 50;
  const maxBatchMb = capabilities.maxTotalBatchSizeMb || 1000;

  const isUnavailableQpdf =
    (tool.id === 'protect-pdf' || tool.id === 'unlock-pdf') && !capabilities.qpdfAvailable;

  useEffect(() => {
    return () => {
      if (clientObjectUrl) URL.revokeObjectURL(clientObjectUrl);
      objectUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [clientObjectUrl]);

  useEffect(() => {
    setFiles([]);
    setImgEntries([]);
    setMergeEntries([]);
    setPdfImgEntries([]);
    setCompressBatchEntries([]);
    setJpgSourceMode('upload');
    setSinglePdfPages([]);
    setPageCount(null);
    setThumbnails([]);
    setPageOrder([]);
    setExtractedText(null);
    setResult(null);
    setError(null);
    setProgressText('');
    setPdfImgFormat(tool.id === 'pdf-to-png' ? 'png' : 'jpeg');
  }, [tool.id]);

  // Load page count or thumbnails for single-PDF tools (split, compress, rotate, reorder, text/word/excel)
  useEffect(() => {
    const first = files[0]?.file;
    if (!first || tool.id === 'jpg-to-pdf' || tool.id === 'merge-pdf' || isPdfToImagesTool) return;

    let cancelled = false;
    (async () => {
      try {
        const count = await getPdfPageCount(first);
        if (!cancelled) {
          setPageCount(count);
          setPageRanges(count > 1 ? `1-${Math.min(2, count)}` : '1');
        }
        if (tool.id === 'reorder-pdf-pages') {
          setLoadingThumbs(true);
          const thumbs = await renderPdfThumbnails(first, 40);
          if (!cancelled) {
            setThumbnails(thumbs);
            setPageOrder(thumbs.map((th) => th.pageNumber - 1));
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not read PDF pages.');
        }
      } finally {
        if (!cancelled) setLoadingThumbs(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [files, tool.id, isPdfToImagesTool]);

  // Handle adding images for JPG -> PDF
  const handleAddJpgToPdfFiles = (incoming: SelectedUploadItem[]) => {
    setError(null);
    const added: ImagePdfEntry[] = incoming.map((item) => {
      const url = item.previewUrl || URL.createObjectURL(item.file);
      objectUrlsRef.current.push(url);
      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file: item.file,
        previewUrl: url,
        rotation: 0,
      };
    });
    setImgEntries((prev) => [...prev, ...added].slice(0, maxBatchFiles));
    void trackAnalyticsEvent('file_uploaded', tool.id, tool.category);
  };

  const handleAddJpgUrlImage = (loaded: LoadedUrlImage) => {
    if (imgEntries.length >= maxBatchFiles) {
      URL.revokeObjectURL(loaded.previewUrl);
      notify(`Maximum ${maxBatchFiles} images per batch.`, 'error');
      return;
    }
    objectUrlsRef.current.push(loaded.previewUrl);
    setImgEntries((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file: loaded.file,
        previewUrl: loaded.previewUrl,
        rotation: 0,
      },
    ]);
    setJpgSourceMode('upload');
    void trackAnalyticsEvent('file_uploaded', tool.id, tool.category);
  };

  // Handle adding PDFs for Merge PDF + validate each lazily
  const handleAddMergeFiles = async (incoming: SelectedUploadItem[]) => {
    setError(null);
    const added: MergePdfEntry[] = incoming.map((item) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file: item.file,
      pageCount: null,
      status: 'checking',
    }));
    setMergeEntries((prev) => [...prev, ...added].slice(0, maxBatchFiles));
    void trackAnalyticsEvent('file_uploaded', tool.id, tool.category);

    for (const entry of added) {
      try {
        const info = await inspectPdfFile(entry.file, false);
        setMergeEntries((prev) =>
          prev.map((m) =>
            m.id === entry.id ? { ...m, pageCount: info.pageCount, status: 'ready' } : m
          )
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Invalid or encrypted PDF.';
        setMergeEntries((prev) =>
          prev.map((m) =>
            m.id === entry.id ? { ...m, status: 'error', errorText: msg } : m
          )
        );
      }
    }
  };

  // Handle adding PDFs for Batch PDF -> Images + lightweight inspection queue
  const handleAddPdfToImagesFiles = async (incoming: SelectedUploadItem[]) => {
    setError(null);
    setSinglePdfPages([]);
    const added: BatchPdfRenderEntry[] = incoming.map((item) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file: item.file,
      fileName: item.file.name,
      sizeBytes: item.file.size,
      pageCount: null,
      detailsText: 'Inspecting...',
      status: 'ready',
    }));

    setPdfImgEntries((prev) => [...prev, ...added].slice(0, maxBatchFiles));
    void trackAnalyticsEvent('file_uploaded', tool.id, tool.category);

    // Inspect 2 at a time so 100 PDFs never freeze browser or exhaust RAM
    const withThumb = added.length <= 24;
    for (let i = 0; i < added.length; i += 2) {
      const slice = added.slice(i, i + 2);
      await Promise.all(
        slice.map(async (entry) => {
          try {
            const info = await inspectPdfFile(entry.file, withThumb);
            setPdfImgEntries((prev) =>
              prev.map((p) =>
                p.id === entry.id
                  ? {
                      ...p,
                      pageCount: info.pageCount,
                      thumbnailUrl: info.thumbnailDataUrl,
                      detailsText: `${info.pageCount} page${info.pageCount === 1 ? '' : 's'}`,
                    }
                  : p
              )
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unreadable PDF';
            setPdfImgEntries((prev) =>
              prev.map((p) =>
                p.id === entry.id
                  ? {
                      ...p,
                      status: 'error',
                      detailsText: 'Cannot read PDF',
                      errorText: msg,
                    }
                  : p
              )
            );
          }
        })
      );
    }
  };

  const moveReorderPage = (index: number, delta: -1 | 1) => {
    const next = index + delta;
    if (next < 0 || next >= pageOrder.length) return;
    const copy = [...pageOrder];
    const [removed] = copy.splice(index, 1);
    copy.splice(next, 0, removed);
    setPageOrder(copy);
  };

  const removePageFromOrder = (index: number) => {
    if (pageOrder.length <= 1) return;
    setPageOrder(pageOrder.filter((_, i) => i !== index));
  };

  const triggerBlobDownload = (blob: Blob, fileName: string) => {
    triggerBlobSave(blob, fileName);
  };

  // Process Batch PDF -> Images with controlled concurrency (max 2 PDFs at once in browser)
  const handleProcessPdfToImages = async () => {
    const validTargets = pdfImgEntries.filter((e) => e.status !== 'error');
    if (validTargets.length === 0) {
      setError('No valid PDF files to convert.');
      return;
    }

    setProcessing(true);
    setError(null);
    setSinglePdfPages([]);
    void trackAnalyticsEvent('processing_started', tool.id, tool.category);

    // Mark valid entries queued
    setPdfImgEntries((prev) =>
      prev.map((p) =>
        p.status === 'error' ? p : { ...p, status: 'queued', errorText: undefined }
      )
    );

    const concurrency = Math.min(2, capabilities.maxConcurrentJobs || 2);
    let cursor = 0;
    const isSingle = validTargets.length === 1;
    const extLabel = pdfImgFormat === 'jpeg' ? 'jpg' : pdfImgFormat;
    let totalRenderedBytes = 0;
    let totalInputBytes = 0;
    let completedFiles = 0;

    const worker = async () => {
      while (cursor < validTargets.length) {
        const entry = validTargets[cursor++];
        setPdfImgEntries((prev) =>
          prev.map((p) =>
            p.id === entry.id ? { ...p, status: 'processing', detailsText: 'Rendering...' } : p
          )
        );

        try {
          const { pages, zipBlob, renderedPageCount } = await renderPdfToImages(entry.file, {
            format: pdfImgFormat,
            dpi: pdfImgDpi,
            quality: pdfImgQuality / 100,
            pageRange: pdfImgPageMode === 'all' ? 'all' : pdfImgPageRange,
            includeDataUrls: isSingle,
            onProgress: (done, total) => {
              setPdfImgEntries((prev) =>
                prev.map((p) =>
                  p.id === entry.id
                    ? { ...p, detailsText: `Page ${done}/${total}` }
                    : p
                )
              );
            },
          });

          const baseName = entry.file.name.replace(/\.pdf$/i, '');
          const zipName = `${baseName}-${extLabel}.zip`;
          const dlUrl = URL.createObjectURL(zipBlob);
          objectUrlsRef.current.push(dlUrl);

          totalInputBytes += entry.file.size;
          totalRenderedBytes += zipBlob.size;
          completedFiles += 1;

          if (isSingle) {
            setSinglePdfPages(pages);
          }

          setPdfImgEntries((prev) =>
            prev.map((p) =>
              p.id === entry.id
                ? {
                    ...p,
                    status: 'done',
                    zipBlob,
                    renderedPages: isSingle ? pages : undefined,
                    downloadUrl: dlUrl,
                    downloadFileName: zipName,
                    outputSizeBytes: zipBlob.size,
                    detailsText: `${renderedPageCount} page${renderedPageCount === 1 ? '' : 's'}`,
                  }
                : p
            )
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Conversion failed.';
          setPdfImgEntries((prev) =>
            prev.map((p) =>
              p.id === entry.id
                ? { ...p, status: 'error', errorText: msg, detailsText: 'Failed' }
                : p
            )
          );
        }
      }
    };

    try {
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      if (completedFiles > 0) {
        void logClientToolExecution({
          toolId: tool.id,
          toolName: tool.name,
          category: tool.category,
          fileName:
            completedFiles === 1
              ? validTargets[0].file.name.replace(/\.pdf$/i, `-${extLabel}.zip`)
              : `${completedFiles} PDFs converted`,
          inputSizeBytes: totalInputBytes,
          outputSizeBytes: totalRenderedBytes,
        });
      }
    } finally {
      setProcessing(false);
    }
  };

  const handleDownloadAllPdfImages = async () => {
    const doneItems = pdfImgEntries.filter((p) => p.status === 'done' && p.zipBlob);
    if (doneItems.length === 0) return;
    if (doneItems.length === 1 && doneItems[0].zipBlob && doneItems[0].downloadFileName) {
      triggerBlobDownload(doneItems[0].zipBlob, doneItems[0].downloadFileName);
      return;
    }

    setBatchZipBusy(true);
    try {
      const masterZip = new JSZip();
      const usedFolders = new Set<string>();
      for (const item of doneItems) {
        if (!item.zipBlob) continue;
        const innerZip = await JSZip.loadAsync(item.zipBlob);
        const rawFolder =
          item.file.name.replace(/\.pdf$/i, '').replace(/[^a-z0-9_-]+/gi, '_') || 'pdf';
        let folderName = rawFolder;
        let suffix = 2;
        while (usedFolders.has(folderName)) {
          folderName = `${rawFolder}-${suffix}`;
          suffix++;
        }
        usedFolders.add(folderName);
        const folder = masterZip.folder(folderName);
        if (folder) {
          for (const [entryName, zipObj] of Object.entries(innerZip.files)) {
            if (!zipObj.dir) {
              const data = await zipObj.async('uint8array');
              folder.file(entryName, data);
            }
          }
        }
      }
      const combined = await masterZip.generateAsync({ type: 'blob', compression: 'STORE' });
      triggerBlobDownload(combined, `rikzen-pdf-images-${doneItems.length}-files.zip`);
      void trackAnalyticsEvent('download_clicked', tool.id, tool.category);
    } catch {
      notify('Could not bundle master ZIP. Please download individual PDFs.', 'error');
    } finally {
      setBatchZipBusy(false);
    }
  };

  const handleBatchCompressPdfs = async () => {
    if (files.length < 2) return;
    setProcessing(true);
    setError(null);
    void trackAnalyticsEvent('processing_started', tool.id, tool.category);

    const queueEntries: BatchPdfCompressEntry[] = files.map((item, idx) => ({
      id: `${idx}-${item.file.name}-${item.file.size}`,
      file: item.file,
      fileName: item.file.name,
      sizeBytes: item.file.size,
      status: 'queued',
    }));
    setCompressBatchEntries(queueEntries);

    try {
      const token = await getToken();
      const concurrency = Math.min(4, Math.max(1, capabilities.maxConcurrentJobs || 4));
      let cursor = 0;

      const worker = async () => {
        while (cursor < queueEntries.length) {
          const target = queueEntries[cursor++];
          setCompressBatchEntries((prev) =>
            prev.map((e) => (e.id === target.id ? { ...e, status: 'processing' } : e))
          );
          try {
            const form = new FormData();
            form.append('file', target.file);
            const res = await fetch('/api/tools/pdf/compress', {
              method: 'POST',
              headers: token ? { Authorization: `Bearer ${token}` } : undefined,
              body: form,
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Compression failed.');
            const secureToken = extractSecureTokenFromUrl(data.downloadUrl) || undefined;
            const tokenParam =
              new URL(data.downloadUrl, window.location.origin).searchParams.get('token') || '';
            setCompressBatchEntries((prev) =>
              prev.map((e) =>
                e.id === target.id
                  ? {
                      ...e,
                      status: 'done',
                      fileId: data.fileId,
                      downloadToken: tokenParam,
                      secureToken,
                      downloadUrl: data.downloadUrl,
                      downloadFileName: data.fileName,
                      outputSizeBytes: data.outputSizeBytes,
                      detailsText: data.pageCount ? `${data.pageCount} pages` : undefined,
                    }
                  : e
              )
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed';
            setCompressBatchEntries((prev) =>
              prev.map((e) =>
                e.id === target.id ? { ...e, status: 'error', errorText: msg } : e
              )
            );
          }
        }
      };

      await Promise.all(Array.from({ length: concurrency }, () => worker()));
    } finally {
      setProcessing(false);
    }
  };

  const handleDownloadAllCompressedPdfs = async () => {
    const done = compressBatchEntries.filter(
      (e) => e.status === 'done' && (e.secureToken || (e.fileId && e.downloadToken))
    );
    if (done.length === 0) return;

    setBatchZipBusy(true);
    try {
      const token = await getToken();
      const res = await fetch('/api/tools/batch/zip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          archiveName: `rikzen-compressed-pdfs-${done.length}.zip`,
          toolId: 'compress-pdf',
          category: 'pdf',
          items: done.map((d) =>
            d.secureToken
              ? { secureToken: d.secureToken }
              : { fileId: d.fileId, token: d.downloadToken }
          ),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create ZIP archive.');
      await downloadFileSafely({
        url: data.downloadUrl,
        fileName: data.fileName,
        mimeType: 'application/zip',
      });
      void trackAnalyticsEvent('download_clicked', tool.id, tool.category);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'ZIP download failed.', 'error');
    } finally {
      setBatchZipBusy(false);
    }
  };

  const handleProcess = async () => {
    setError(null);
    setProgressText('');
    setProcessing(true);
    void trackAnalyticsEvent('processing_started', tool.id, tool.category);

    try {
      // 1. JPG / Image -> PDF
      if (tool.id === 'jpg-to-pdf') {
        if (imgEntries.length === 0) {
          setProcessing(false);
          return;
        }
        setProgressText(`Building PDF from ${imgEntries.length} image${imgEntries.length > 1 ? 's' : ''}...`);
        const token = await getToken();
        const form = new FormData();
        imgEntries.forEach((item) => form.append('files', item.file));
        form.append('rotations', JSON.stringify(imgEntries.map((i) => i.rotation)));
        form.append('pageSize', jpgToPdfSize);
        form.append('orientation', jpgToPdfOrientation);
        form.append('margin', jpgToPdfMargin);
        form.append('fitMode', jpgToPdfFit);

        const res = await fetch('/api/tools/pdf/jpg-to-pdf', {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          body: form,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not create PDF from images.');

        setResult({
          fileName: data.fileName,
          mimeType: data.mimeType,
          originalSizeBytes: data.originalSizeBytes,
          outputSizeBytes: data.outputSizeBytes,
          downloadUrl: data.downloadUrl,
          primaryLabel: 'Download PDF',
          resetLabel: 'Create Another',
          extraNote: `${data.pageCount} page${data.pageCount > 1 ? 's' : ''}`,
        });
        return;
      }

      // 2. Merge PDF
      if (tool.id === 'merge-pdf') {
        if (mergeEntries.length < 2) {
          setProcessing(false);
          return;
        }
        const invalidEntry = mergeEntries.find((m) => m.status === 'error');
        if (invalidEntry) {
          throw new Error(
            invalidEntry.errorText || `"${invalidEntry.file.name}" cannot be merged. Please remove it.`
          );
        }

        setProgressText(`Merging ${mergeEntries.length} PDFs...`);
        const token = await getToken();
        const form = new FormData();
        mergeEntries.forEach((entry) => form.append('files', entry.file));

        const res = await fetch('/api/tools/pdf/merge', {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          body: form,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not merge these PDFs.');

        setResult({
          fileName: data.fileName,
          mimeType: data.mimeType,
          originalSizeBytes: data.originalSizeBytes,
          outputSizeBytes: data.outputSizeBytes,
          downloadUrl: data.downloadUrl,
          primaryLabel: 'Download Merged PDF',
          resetLabel: 'Merge More PDFs',
          extraNote: `${data.pageCount} page${data.pageCount > 1 ? 's' : ''} combined from ${data.fileCount || mergeEntries.length} PDFs`,
        });
        return;
      }

      if (files.length === 0) {
        setProcessing(false);
        return;
      }

      // 3. Client-side Text / Word / Excel extraction
      if (tool.id === 'pdf-to-text') {
        const pages = await extractPdfTextPages(files[0].file);
        const fullText = pages
          .map((p) => (pages.length > 1 ? `--- Page ${p.pageNumber} ---\n${p.text}` : p.text))
          .join('\n\n');
        setExtractedText(fullText || '(No selectable text found in this PDF)');
        const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        setClientObjectUrl(url);
        const outName = files[0].file.name.replace(/\.pdf$/i, '.txt');
        setResult({
          fileName: outName,
          mimeType: 'text/plain; charset=utf-8',
          originalSizeBytes: files[0].file.size,
          outputSizeBytes: blob.size,
          downloadUrl: url,
          fileBlob: blob,
          extraNote: `${pages.length} page${pages.length > 1 ? 's' : ''}`,
        });
        void logClientToolExecution({
          toolId: tool.id,
          toolName: tool.name,
          category: tool.category,
          fileName: outName,
          inputSizeBytes: files[0].file.size,
          outputSizeBytes: blob.size,
        });
        return;
      }

      if (tool.id === 'pdf-to-word') {
        setProgressText('Extracting document structure...');
        const docxBlob = await convertPdfToDocxBlob(files[0].file);
        const url = URL.createObjectURL(docxBlob);
        setClientObjectUrl(url);
        const outName = files[0].file.name.replace(/\.pdf$/i, '.docx');
        setResult({
          fileName: outName,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          originalSizeBytes: files[0].file.size,
          outputSizeBytes: docxBlob.size,
          downloadUrl: url,
          fileBlob: docxBlob,
        });
        void logClientToolExecution({
          toolId: tool.id,
          toolName: tool.name,
          category: tool.category,
          fileName: outName,
          inputSizeBytes: files[0].file.size,
          outputSizeBytes: docxBlob.size,
        });
        return;
      }

      if (tool.id === 'pdf-to-excel') {
        setProgressText('Extracting tables and rows...');
        const xlsxBlob = await convertPdfToExcelBlob(files[0].file);
        const url = URL.createObjectURL(xlsxBlob);
        setClientObjectUrl(url);
        const outName = files[0].file.name.replace(/\.pdf$/i, '.xlsx');
        setResult({
          fileName: outName,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          originalSizeBytes: files[0].file.size,
          outputSizeBytes: xlsxBlob.size,
          downloadUrl: url,
          fileBlob: xlsxBlob,
        });
        void logClientToolExecution({
          toolId: tool.id,
          toolName: tool.name,
          category: tool.category,
          fileName: outName,
          inputSizeBytes: files[0].file.size,
          outputSizeBytes: xlsxBlob.size,
        });
        return;
      }

      // 4. Server-side single-PDF tools (split, compress, rotate, reorder)
      const token = await getToken();
      const form = new FormData();
      let endpoint = '/api/tools/pdf/compress';

      if (tool.id === 'split-pdf') {
        endpoint = '/api/tools/pdf/split';
        form.append('file', files[0].file);
        form.append('mode', splitMode);
        form.append('pages', pageRanges);
      } else if (tool.id === 'compress-pdf') {
        endpoint = '/api/tools/pdf/compress';
        form.append('file', files[0].file);
      } else if (tool.id === 'rotate-pdf') {
        endpoint = '/api/tools/pdf/rotate';
        form.append('file', files[0].file);
        form.append('angle', String(rotateAngle));
        form.append('pages', rotatePages);
      } else if (tool.id === 'reorder-pdf-pages') {
        endpoint = '/api/tools/pdf/reorder';
        form.append('file', files[0].file);
        form.append('order', JSON.stringify(pageOrder));
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not process PDF.');

      setResult({
        fileName: data.fileName,
        mimeType: data.mimeType,
        originalSizeBytes: data.originalSizeBytes,
        outputSizeBytes: data.outputSizeBytes,
        downloadUrl: data.downloadUrl,
        extraNote: data.pageCount ? `${data.pageCount} page${data.pageCount > 1 ? 's' : ''}` : undefined,
      });
    } catch (err) {
      setError(
        err instanceof TypeError
          ? 'Connection problem. Please check your network and retry.'
          : err instanceof Error
          ? err.message
          : 'Something went wrong. Please try again.'
      );
    } finally {
      setProcessing(false);
    }
  };

  if (isUnavailableQpdf) {
    return (
      <div className="rounded-3xl border border-amber-300 dark:border-amber-800/60 bg-amber-50/80 dark:bg-amber-950/30 p-7 space-y-3">
        <div className="flex items-center gap-3 text-amber-900 dark:text-amber-200 font-bold text-base">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>Backend Configuration Required</span>
        </div>
        <p className="text-sm text-amber-800 dark:text-amber-300 leading-relaxed">
          Real PDF encryption and password removal require the <code className="font-mono font-semibold">qpdf</code> binary on the server, which is not installed in this runtime. Rather than creating fake locked/unlocked files, this tool stays disabled until configured.
        </p>
      </div>
    );
  }

  if (result) {
    return (
      <div className="space-y-6">
        <ToolResultCard
          result={result}
          onDownloadClick={() => void trackAnalyticsEvent('download_clicked', tool.id, tool.category)}
          onReset={() => {
            setFiles([]);
            setImgEntries([]);
            setMergeEntries([]);
            setPdfImgEntries([]);
            setSinglePdfPages([]);
            setResult(null);
            setExtractedText(null);
            setPageCount(null);
            setError(null);
          }}
        />

        {extractedText !== null && (
          <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-[#111214] dark:text-[#F4F4F0]">
                Extracted Text
              </h4>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard?.writeText(extractedText);
                  notify('Text copied to clipboard.', 'success');
                }}
                className="min-h-[36px] px-3 rounded-xl border border-[#DDD8CE] dark:border-[#2C313D] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                Copy Text
              </button>
            </div>
            <pre className="max-h-80 overflow-auto rounded-2xl bg-[#FAF8F4] dark:bg-[#0D0F14] p-4 text-xs font-mono whitespace-pre-wrap text-[#111214] dark:text-[#F4F4F0] border border-[#E2DED4] dark:border-[#232833]">
              {extractedText}
            </pre>
          </div>
        )}
      </div>
    );
  }

  // SPECIAL WORKSPACE A: JPG / IMAGE -> PDF (Up to 100 images, reorder, rotate, preview, page setup)
  if (tool.id === 'jpg-to-pdf') {
    const moveImg = (from: number, to: number) => {
      if (to < 0 || to >= imgEntries.length || from === to) return;
      setImgEntries((prev) => {
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    };

    const rotateImg = (id: string) => {
      setImgEntries((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, rotation: (item.rotation + 90) % 360 } : item
        )
      );
    };

    const removeImg = (id: string) => {
      setImgEntries((prev) => {
        const target = prev.find((i) => i.id === id);
        if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
        return prev.filter((item) => item.id !== id);
      });
    };

    return (
      <div className="space-y-6">
        <div className="space-y-4">
          <div className="inline-flex p-1 rounded-2xl border border-[#E2DED4] dark:border-[#232833] bg-[#F4F1EA] dark:bg-[#12151B]">
            <button
              type="button"
              onClick={() => setJpgSourceMode('upload')}
              className={`min-h-[38px] px-4 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                jpgSourceMode === 'upload'
                  ? 'bg-white dark:bg-[#1E232E] text-[#111214] dark:text-[#F4F4F0] shadow-xs'
                  : 'text-[#6B707B] dark:text-[#9CA0AA]'
              }`}
            >
              Upload Images
            </button>
            <button
              type="button"
              onClick={() => setJpgSourceMode('url')}
              className={`min-h-[38px] px-4 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                jpgSourceMode === 'url'
                  ? 'bg-white dark:bg-[#1E232E] text-[#111214] dark:text-[#F4F4F0] shadow-xs'
                  : 'text-[#6B707B] dark:text-[#9CA0AA]'
              }`}
            >
              🖼️ Image URL
            </button>
          </div>

          {jpgSourceMode === 'upload' ? (
            <UploadZone
              accept={tool.acceptAttr}
              supportedFormats={tool.supportedFormats}
              maxSizeMb={maxSizeMb}
              maxFiles={maxBatchFiles}
              maxTotalMb={maxBatchMb}
              multiple
              allowCamera
              hideFileList
              compactWhenHasFiles
              ctaLabel={imgEntries.length === 0 ? 'Upload Images' : 'Add More Images'}
              files={imgEntries.map((i) => ({ file: i.file, previewUrl: i.previewUrl }))}
              onFilesSelected={(items) => handleAddJpgToPdfFiles(items.slice(imgEntries.length))}
              onRemoveFile={() => {}}
            />
          ) : (
            <ImageUrlLoader
              actionLabel={imgEntries.length > 0 ? 'Add Image to PDF' : 'Use This Image'}
              onUseImage={handleAddJpgUrlImage}
            />
          )}
        </div>

        {imgEntries.length > 0 && (
          <>
            {/* Thumbnail Grid with Drag-to-Reorder, Rotate, Preview, Delete */}
            <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold text-[#111214] dark:text-[#F4F4F0]">
                    {imgEntries.length} Image{imgEntries.length === 1 ? '' : 's'} Selected
                  </h2>
                  <p className="text-xs text-[#6B707B] dark:text-[#9CA0AA]">
                    Drag cards or use arrows to reorder pages
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const revoked = new Set<string>();
                    imgEntries.forEach((entry) => {
                      if (entry.previewUrl) {
                        URL.revokeObjectURL(entry.previewUrl);
                        revoked.add(entry.previewUrl);
                      }
                    });
                    objectUrlsRef.current = objectUrlsRef.current.filter((u) => !revoked.has(u));
                    setImgEntries([]);
                  }}
                  className="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline cursor-pointer"
                >
                  Clear all
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 max-h-[520px] overflow-y-auto pr-1">
                {imgEntries.map((entry, idx) => (
                  <div
                    key={entry.id}
                    draggable
                    onDragStart={() => setDragIdx(idx)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragIdx !== null) moveImg(dragIdx, idx);
                      setDragIdx(null);
                    }}
                    className={`group rounded-2xl border bg-[#FAF8F4] dark:bg-[#0D0F14] p-2.5 space-y-2 transition-all cursor-grab active:cursor-grabbing ${
                      dragIdx === idx
                        ? 'border-[#C9A227] opacity-60'
                        : 'border-[#E2DED4] dark:border-[#232833] hover:border-[#C9A227]/70'
                    }`}
                  >
                    <div className="relative h-28 rounded-xl bg-white dark:bg-[#161A22] overflow-hidden flex items-center justify-center">
                      <img
                        src={entry.previewUrl}
                        alt={entry.file.name}
                        className="max-h-full max-w-full object-contain transition-transform duration-200"
                        style={{ transform: `rotate(${entry.rotation}deg)` }}
                      />
                      <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/70 text-white text-[10px] font-mono font-bold tabular-nums">
                        #{idx + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPreviewImgItem(entry)}
                        aria-label={`Preview ${entry.file.name}`}
                        className="absolute top-1.5 right-1.5 w-7 h-7 rounded-lg bg-black/65 text-white flex items-center justify-center opacity-85 hover:opacity-100 cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <p className="text-[11px] font-medium text-[#111214] dark:text-[#F4F4F0] truncate">
                      {entry.file.name}
                    </p>

                    <div className="flex items-center justify-between gap-1 pt-0.5">
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => moveImg(idx, idx - 1)}
                          aria-label="Move left"
                          className="w-7 h-7 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 flex items-center justify-center cursor-pointer"
                        >
                          <ArrowLeft className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === imgEntries.length - 1}
                          onClick={() => moveImg(idx, idx + 1)}
                          aria-label="Move right"
                          className="w-7 h-7 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 flex items-center justify-center cursor-pointer"
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => rotateImg(entry.id)}
                          aria-label="Rotate 90°"
                          className="w-7 h-7 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-[#B88E1E] dark:text-[#D4AF37] flex items-center justify-center cursor-pointer"
                        >
                          <RotateCw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeImg(entry.id)}
                          aria-label="Delete image"
                          className="w-7 h-7 rounded-lg hover:bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Page Settings */}
            <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-5 sm:p-6 space-y-5">
              <div className="flex items-center gap-2 text-sm font-bold text-[#111214] dark:text-[#F4F4F0]">
                <SlidersHorizontal className="w-4 h-4 text-[#C9A227]" />
                <span>PDF Layout Settings</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA] block">
                    Page Size
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { id: 'a4', label: 'A4' },
                        { id: 'letter', label: 'Letter' },
                        { id: 'fit', label: 'Fit' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setJpgToPdfSize(opt.id)}
                        className={`min-h-[40px] rounded-xl text-xs font-semibold border cursor-pointer ${
                          jpgToPdfSize === opt.id
                            ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] border-transparent'
                            : 'border-[#DDD8CE] dark:border-[#2C313D] text-[#5A5D65] dark:text-[#9CA0AA]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {jpgToPdfSize !== 'fit' && (
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA] block">
                      Orientation
                    </span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(
                        [
                          { id: 'auto', label: 'Auto' },
                          { id: 'portrait', label: 'Portrait' },
                          { id: 'landscape', label: 'Land' },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setJpgToPdfOrientation(opt.id)}
                          className={`min-h-[40px] rounded-xl text-xs font-semibold border cursor-pointer ${
                            jpgToPdfOrientation === opt.id
                              ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] border-transparent'
                              : 'border-[#DDD8CE] dark:border-[#2C313D] text-[#5A5D65] dark:text-[#9CA0AA]'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA] block">
                    Margin
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { id: 'none', label: 'None' },
                        { id: 'small', label: 'Small' },
                        { id: 'normal', label: 'Normal' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setJpgToPdfMargin(opt.id)}
                        className={`min-h-[40px] rounded-xl text-xs font-semibold border cursor-pointer ${
                          jpgToPdfMargin === opt.id
                            ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] border-transparent'
                            : 'border-[#DDD8CE] dark:border-[#2C313D] text-[#5A5D65] dark:text-[#9CA0AA]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {jpgToPdfSize !== 'fit' && (
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA] block">
                      Image Fit Mode
                    </span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(
                        [
                          { id: 'contain', label: 'Contain' },
                          { id: 'cover', label: 'Cover' },
                          { id: 'stretch', label: 'Stretch' },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setJpgToPdfFit(opt.id)}
                          className={`min-h-[40px] rounded-xl text-xs font-semibold border cursor-pointer ${
                            jpgToPdfFit === opt.id
                              ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] border-transparent'
                              : 'border-[#DDD8CE] dark:border-[#2C313D] text-[#5A5D65] dark:text-[#9CA0AA]'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {error && (
                <div
                  role="alert"
                  className="rounded-2xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200"
                >
                  {error}
                </div>
              )}

              <button
                type="button"
                disabled={processing}
                onClick={() => void handleProcess()}
                className="w-full min-h-[50px] rounded-2xl bg-gradient-to-b from-[#1C1E24] to-[#0E1014] dark:from-[#E0BC46] dark:to-[#C59D24] text-white dark:text-[#0B0C0E] px-6 py-3.5 text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-95 disabled:opacity-50 cursor-pointer shadow-sm"
              >
                {processing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{progressText || t.processing}</span>
                  </>
                ) : (
                  <span>Create PDF ({imgEntries.length} image{imgEntries.length > 1 ? 's' : ''})</span>
                )}
              </button>
            </div>
          </>
        )}

        {previewImgItem && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={() => setPreviewImgItem(null)}
          >
            <div
              className="relative max-w-2xl w-full rounded-3xl bg-[#12151B] border border-[#2A2F3D] p-4 space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between text-white">
                <span className="text-sm font-semibold truncate">{previewImgItem.file.name}</span>
                <button
                  type="button"
                  onClick={() => setPreviewImgItem(null)}
                  className="p-2 rounded-xl hover:bg-white/10 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="h-[60vh] flex items-center justify-center overflow-hidden rounded-2xl bg-black/40">
                <img
                  src={previewImgItem.previewUrl}
                  alt={previewImgItem.file.name}
                  className="max-h-full max-w-full object-contain transition-transform"
                  style={{ transform: `rotate(${previewImgItem.rotation}deg)` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // SPECIAL WORKSPACE B: MERGE PDF (Numbered PDF 1, PDF 2... reorder, remove, add more, real validation)
  if (tool.id === 'merge-pdf') {
    const moveMergePdf = (from: number, to: number) => {
      if (to < 0 || to >= mergeEntries.length || from === to) return;
      setMergeEntries((prev) => {
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    };

    const removeMergePdf = (id: string) => {
      setMergeEntries((prev) => prev.filter((m) => m.id !== id));
    };

    const hasBadPdf = mergeEntries.some((m) => m.status === 'error');
    const stillChecking = mergeEntries.some((m) => m.status === 'checking');

    return (
      <div className="space-y-6">
        <UploadZone
          accept={tool.acceptAttr}
          supportedFormats={tool.supportedFormats}
          maxSizeMb={maxSizeMb}
          maxFiles={maxBatchFiles}
          maxTotalMb={maxBatchMb}
          multiple
          hideFileList
          compactWhenHasFiles
          ctaLabel={mergeEntries.length === 0 ? 'Upload PDFs to Merge' : 'Add More PDFs'}
          files={mergeEntries.map((m) => ({ file: m.file }))}
          onFilesSelected={(items) => void handleAddMergeFiles(items.slice(mergeEntries.length))}
          onRemoveFile={() => {}}
        />

        {mergeEntries.length > 0 && (
          <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-5 sm:p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-[#111214] dark:text-[#F4F4F0]">
                  Merge Queue ({mergeEntries.length} PDF{mergeEntries.length === 1 ? '' : 's'})
                </h2>
                <p className="text-xs text-[#6B707B] dark:text-[#9CA0AA]">
                  Drag or use arrows to set the exact order (PDF 1 → PDF {mergeEntries.length})
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMergeEntries([]);
                  setError(null);
                }}
                className="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline cursor-pointer"
              >
                Clear all
              </button>
            </div>

            <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
              {mergeEntries.map((entry, idx) => (
                <div
                  key={entry.id}
                  draggable
                  onDragStart={() => setMergeDragIdx(idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (mergeDragIdx !== null) moveMergePdf(mergeDragIdx, idx);
                    setMergeDragIdx(null);
                  }}
                  className={`rounded-2xl border p-3.5 flex items-center justify-between gap-3 transition-colors cursor-grab active:cursor-grabbing ${
                    entry.status === 'error'
                      ? 'border-red-300 dark:border-red-800 bg-red-50/60 dark:bg-red-950/30'
                      : mergeDragIdx === idx
                      ? 'border-[#C9A227] bg-[#C9A227]/8'
                      : 'border-[#E2DED4] dark:border-[#232833] bg-[#FAF8F4] dark:bg-[#0D0F14]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <GripVertical className="w-4 h-4 text-[#8E939E] shrink-0" />
                    <span className="px-2.5 py-1 rounded-lg bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-xs font-mono font-bold shrink-0">
                      PDF {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[#111214] dark:text-[#F4F4F0] truncate">
                        {entry.file.name}
                      </p>
                      <p className="text-xs font-mono tabular-nums text-[#6B707B] dark:text-[#9CA0AA]">
                        {formatBytes(entry.file.size)}
                        {entry.pageCount !== null ? ` · ${entry.pageCount} page${entry.pageCount === 1 ? '' : 's'}` : ''}
                        {entry.status === 'checking' ? ' · Checking...' : ''}
                      </p>
                      {entry.errorText && (
                        <p className="text-xs font-medium text-red-600 dark:text-red-400 mt-0.5">
                          {entry.errorText}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveMergePdf(idx, idx - 1)}
                      aria-label="Move up"
                      className="min-h-[36px] min-w-[36px] rounded-xl hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 flex items-center justify-center cursor-pointer"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === mergeEntries.length - 1}
                      onClick={() => moveMergePdf(idx, idx + 1)}
                      aria-label="Move down"
                      className="min-h-[36px] min-w-[36px] rounded-xl hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 flex items-center justify-center cursor-pointer"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeMergePdf(entry.id)}
                      aria-label={`Remove ${entry.file.name}`}
                      className="min-h-[36px] min-w-[36px] rounded-xl text-red-600 dark:text-red-400 hover:bg-red-500/10 flex items-center justify-center cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {mergeEntries.length < 2 && (
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                Add at least 1 more PDF file above to merge them together.
              </p>
            )}

            {error && (
              <div
                role="alert"
                className="rounded-2xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200"
              >
                {error}
              </div>
            )}

            <button
              type="button"
              disabled={processing || mergeEntries.length < 2 || hasBadPdf || stillChecking}
              onClick={() => void handleProcess()}
              className="w-full min-h-[50px] rounded-2xl bg-gradient-to-b from-[#1C1E24] to-[#0E1014] dark:from-[#E0BC46] dark:to-[#C59D24] text-white dark:text-[#0B0C0E] px-6 py-3.5 text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-95 disabled:opacity-50 cursor-pointer shadow-sm"
            >
              {processing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{progressText || t.processing}</span>
                </>
              ) : (
                <span>Merge PDFs ({mergeEntries.length})</span>
              )}
            </button>
          </div>
        )}
      </div>
    );
  }

  // SPECIAL WORKSPACE C: BATCH PDF -> IMAGES (JPG / PNG / WebP, up to 100 PDFs, controlled queue, ZIP)
  if (isPdfToImagesTool) {
    const validCount = pdfImgEntries.filter((p) => p.status !== 'error').length;
    const doneCount = pdfImgEntries.filter((p) => p.status === 'done').length;

    return (
      <div className="space-y-6">
        <UploadZone
          accept={tool.acceptAttr}
          supportedFormats={tool.supportedFormats}
          maxSizeMb={maxSizeMb}
          maxFiles={maxBatchFiles}
          maxTotalMb={maxBatchMb}
          multiple
          hideFileList
          compactWhenHasFiles
          ctaLabel={pdfImgEntries.length === 0 ? 'Upload PDFs' : 'Add More PDFs'}
          files={pdfImgEntries.map((p) => ({ file: p.file }))}
          onFilesSelected={(items) => void handleAddPdfToImagesFiles(items.slice(pdfImgEntries.length))}
          onRemoveFile={() => {}}
        />

        {pdfImgEntries.length > 0 && (
          <>
            {/* Settings Card */}
            <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-5 sm:p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-bold text-[#111214] dark:text-[#F4F4F0]">
                  <SlidersHorizontal className="w-4 h-4 text-[#C9A227]" />
                  <span>Conversion Settings</span>
                </div>
                {!processing && (
                  <button
                    type="button"
                    onClick={() => {
                      setPdfImgEntries([]);
                      setSinglePdfPages([]);
                      setError(null);
                    }}
                    className="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline cursor-pointer"
                  >
                    Clear batch
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA] block">
                    Output Format
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { id: 'jpeg', label: 'JPG' },
                        { id: 'png', label: 'PNG' },
                        { id: 'webp', label: 'WebP' },
                      ] as const
                    ).map((fmt) => (
                      <button
                        key={fmt.id}
                        type="button"
                        disabled={processing}
                        onClick={() => setPdfImgFormat(fmt.id)}
                        className={`min-h-[40px] rounded-xl text-xs font-semibold border cursor-pointer ${
                          pdfImgFormat === fmt.id
                            ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] border-transparent'
                            : 'border-[#DDD8CE] dark:border-[#2C313D] text-[#5A5D65] dark:text-[#9CA0AA]'
                        }`}
                      >
                        {fmt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA] block">
                    Resolution (DPI)
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {([72, 150, 300] as const).map((dpi) => (
                      <button
                        key={dpi}
                        type="button"
                        disabled={processing}
                        onClick={() => setPdfImgDpi(dpi)}
                        className={`min-h-[40px] rounded-xl text-xs font-semibold font-mono border cursor-pointer ${
                          pdfImgDpi === dpi
                            ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] border-transparent'
                            : 'border-[#DDD8CE] dark:border-[#2C313D] text-[#5A5D65] dark:text-[#9CA0AA]'
                        }`}
                      >
                        {dpi}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">
                      Image Quality
                    </span>
                    <span className="font-mono font-bold text-[#C9A227]">
                      {pdfImgFormat === 'png' ? 'Lossless' : `${pdfImgQuality}%`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={30}
                    max={98}
                    disabled={processing || pdfImgFormat === 'png'}
                    value={pdfImgQuality}
                    onChange={(e) => setPdfImgQuality(Number(e.target.value))}
                    className="w-full accent-[#C9A227] mt-2"
                  />
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA] block">
                    Pages
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      disabled={processing}
                      onClick={() => setPdfImgPageMode('all')}
                      className={`min-h-[40px] rounded-xl text-xs font-semibold border cursor-pointer ${
                        pdfImgPageMode === 'all'
                          ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] border-transparent'
                          : 'border-[#DDD8CE] dark:border-[#2C313D] text-[#5A5D65] dark:text-[#9CA0AA]'
                      }`}
                    >
                      All Pages
                    </button>
                    <button
                      type="button"
                      disabled={processing}
                      onClick={() => setPdfImgPageMode('custom')}
                      className={`min-h-[40px] rounded-xl text-xs font-semibold border cursor-pointer ${
                        pdfImgPageMode === 'custom'
                          ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] border-transparent'
                          : 'border-[#DDD8CE] dark:border-[#2C313D] text-[#5A5D65] dark:text-[#9CA0AA]'
                      }`}
                    >
                      Selected
                    </button>
                  </div>
                </div>
              </div>

              {pdfImgPageMode === 'custom' && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">
                    Page numbers or ranges per PDF (e.g. 1-3, 5)
                  </span>
                  <input
                    type="text"
                    value={pdfImgPageRange}
                    disabled={processing}
                    onChange={(e) => setPdfImgPageRange(e.target.value)}
                    placeholder="1-3, 5"
                    className="w-full sm:w-72 min-h-[42px] rounded-xl border border-[#DDD8CE] dark:border-[#2C313D] bg-[#FAF8F4] dark:bg-[#0D0F14] px-3.5 text-sm font-mono"
                  />
                </label>
              )}

              {error && (
                <div
                  role="alert"
                  className="rounded-2xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200"
                >
                  {error}
                </div>
              )}

              <button
                type="button"
                disabled={processing || validCount === 0}
                onClick={() => void handleProcessPdfToImages()}
                className="w-full min-h-[50px] rounded-2xl bg-gradient-to-b from-[#1C1E24] to-[#0E1014] dark:from-[#E0BC46] dark:to-[#C59D24] text-white dark:text-[#0B0C0E] px-6 py-3.5 text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-95 disabled:opacity-50 cursor-pointer shadow-sm"
              >
                {processing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Converting PDFs ({doneCount}/{validCount})...</span>
                  </>
                ) : (
                  <span>
                    Convert {validCount} PDF{validCount === 1 ? '' : 's'} to{' '}
                    {pdfImgFormat === 'jpeg' ? 'JPG' : pdfImgFormat.toUpperCase()}
                  </span>
                )}
              </button>
            </div>

            {/* Batch Queue Status Table */}
            <BatchStatusTable
              items={pdfImgEntries}
              processing={processing}
              zipBusy={batchZipBusy}
              startLabel={`Start Processing (${validCount})`}
              onStartProcessing={() => void handleProcessPdfToImages()}
              onClearAll={() => {
                setPdfImgEntries([]);
                setSinglePdfPages([]);
                setError(null);
              }}
              downloadAllLabel={
                doneCount > 1 ? `Download All (${doneCount} ZIP)` : 'Download ZIP'
              }
              onDownloadItem={(item) => {
                const entry = pdfImgEntries.find((p) => p.id === item.id);
                if (entry?.zipBlob && entry.downloadFileName) {
                  triggerBlobDownload(entry.zipBlob, entry.downloadFileName);
                }
              }}
              onDownloadAll={() => void handleDownloadAllPdfImages()}
              onRemoveItem={(id) => {
                setPdfImgEntries((prev) => prev.filter((p) => p.id !== id));
                setSinglePdfPages([]);
              }}
            />

            {/* Single-PDF individual page gallery when 1 PDF is converted */}
            {singlePdfPages.length > 0 && (
              <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-6 space-y-4">
                <h4 className="text-sm font-bold text-[#111214] dark:text-[#F4F4F0]">
                  Individual Pages ({singlePdfPages.length})
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {singlePdfPages.map((pg) => (
                    <div
                      key={pg.pageNumber}
                      className="rounded-2xl border border-[#E2DED4] dark:border-[#232833] p-2.5 space-y-2 bg-[#FAF8F4] dark:bg-[#0D0F14]"
                    >
                      <img
                        src={pg.dataUrl}
                        alt={`Page ${pg.pageNumber}`}
                        className="w-full h-36 object-contain rounded-xl bg-white"
                      />
                      <div className="flex items-center justify-between text-xs px-1">
                        <span className="font-mono tabular-nums text-[#5A5D65] dark:text-[#9CA0AA]">
                          Page {pg.pageNumber}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            triggerBlobDownload(
                              pg.blob,
                              `page-${pg.pageNumber}.${pdfImgFormat === 'jpeg' ? 'jpg' : pdfImgFormat}`
                            )
                          }
                          className="text-[#B88E1E] dark:text-[#D4AF37] font-semibold inline-flex items-center gap-1 hover:underline cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Save
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // STANDARD + BATCH COMPRESS WORKSPACE (compress supports up to 50 PDFs; split, rotate, reorder, text, word, excel)
  const isBatchPdfTool = tool.id === 'compress-pdf';

  return (
    <div className="space-y-6">
      <UploadZone
        accept={tool.acceptAttr}
        supportedFormats={tool.supportedFormats}
        maxSizeMb={maxSizeMb}
        maxFiles={maxBatchFiles}
        maxTotalMb={maxBatchMb}
        multiple={isBatchPdfTool}
        hideFileList={isBatchPdfTool && files.length > 1}
        compactWhenHasFiles={isBatchPdfTool && files.length > 0}
        files={files}
        onFilesSelected={(items) => {
          setFiles(items);
          setCompressBatchEntries([]);
          setError(null);
          void trackAnalyticsEvent('file_uploaded', tool.id, tool.category);
        }}
        onRemoveFile={(idx) => {
          setFiles((prev) => prev.filter((_, i) => i !== idx));
          setCompressBatchEntries([]);
          if (files.length <= 1) {
            setPageCount(null);
            setThumbnails([]);
            setPageOrder([]);
          }
        }}
      />

      {isBatchPdfTool && files.length > 1 && (
        <BatchStatusTable
          items={
            compressBatchEntries.length > 0
              ? compressBatchEntries
              : files.map((f, idx) => ({
                  id: `${idx}-${f.file.name}`,
                  fileName: f.file.name,
                  sizeBytes: f.file.size,
                  status: 'ready',
                }))
          }
          processing={processing}
          zipBusy={batchZipBusy}
          startLabel={`Compress All (${files.length} PDFs)`}
          onStartProcessing={() => void handleBatchCompressPdfs()}
          onClearAll={() => {
            setFiles([]);
            setCompressBatchEntries([]);
            setError(null);
          }}
          onDownloadItem={(item) => {
            if (item.downloadUrl) {
              void downloadFileSafely({
                url: item.downloadUrl,
                fileName: item.downloadFileName || item.fileName,
                mimeType: 'application/pdf',
              }).catch((err) =>
                notify(err instanceof Error ? err.message : 'Download failed.', 'error')
              );
            }
          }}
          onDownloadAll={() => void handleDownloadAllCompressedPdfs()}
          onRemoveItem={(id) => {
            const idx = Number(id.split('-')[0]);
            if (Number.isInteger(idx)) {
              setFiles((prev) => prev.filter((_, i) => i !== idx));
            }
            setCompressBatchEntries((prev) => prev.filter((e) => e.id !== id));
          }}
        />
      )}

      {files.length > 0 && !(isBatchPdfTool && files.length > 1) && (
        <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-6 space-y-5">
          {pageCount !== null && (
            <div className="inline-flex items-center gap-2 text-xs font-mono tabular-nums text-[#5A5D65] dark:text-[#9CA0AA]">
              <FileText className="w-3.5 h-3.5 text-[#C9A227]" />
              <span>Detected {pageCount} page{pageCount > 1 ? 's' : ''}</span>
            </div>
          )}

          {tool.id === 'split-pdf' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSplitMode('range')}
                  className={`min-h-[44px] rounded-xl text-xs font-semibold border cursor-pointer ${
                    splitMode === 'range'
                      ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] border-transparent'
                      : 'border-[#DDD8CE] dark:border-[#2C313D] text-[#5A5D65] dark:text-[#9CA0AA]'
                  }`}
                >
                  Extract Page Range
                </button>
                <button
                  type="button"
                  onClick={() => setSplitMode('all-zip')}
                  className={`min-h-[44px] rounded-xl text-xs font-semibold border cursor-pointer ${
                    splitMode === 'all-zip'
                      ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] border-transparent'
                      : 'border-[#DDD8CE] dark:border-[#2C313D] text-[#5A5D65] dark:text-[#9CA0AA]'
                  }`}
                >
                  Split Every Page (ZIP)
                </button>
              </div>
              {splitMode === 'range' && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">
                    Pages to extract (e.g. 1-3, 5)
                  </span>
                  <input
                    type="text"
                    value={pageRanges}
                    onChange={(e) => setPageRanges(e.target.value)}
                    placeholder="1-3, 5"
                    className="w-full min-h-[44px] rounded-xl border border-[#DDD8CE] dark:border-[#2C313D] bg-[#FAF8F4] dark:bg-[#0D0F14] px-4 text-sm font-mono"
                  />
                </label>
              )}
            </div>
          )}

          {tool.id === 'rotate-pdf' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">
                  Rotation Angle
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {[90, 180, 270].map((deg) => (
                    <button
                      key={deg}
                      type="button"
                      onClick={() => setRotateAngle(deg)}
                      className={`min-h-[42px] rounded-xl text-xs font-semibold font-mono border cursor-pointer ${
                        rotateAngle === deg
                          ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] border-transparent'
                          : 'border-[#DDD8CE] dark:border-[#2C313D] text-[#5A5D65] dark:text-[#9CA0AA]'
                      }`}
                    >
                      {deg}°
                    </button>
                  ))}
                </div>
              </div>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">
                  Pages ("all" or e.g. 1,3-4)
                </span>
                <input
                  type="text"
                  value={rotatePages}
                  onChange={(e) => setRotatePages(e.target.value)}
                  className="w-full min-h-[42px] rounded-xl border border-[#DDD8CE] dark:border-[#2C313D] bg-[#FAF8F4] dark:bg-[#0D0F14] px-3.5 text-sm font-mono"
                />
              </label>
            </div>
          )}

          {tool.id === 'reorder-pdf-pages' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-[#111214] dark:text-[#F4F4F0]">
                  Arrange or Remove Pages
                </span>
                <button
                  type="button"
                  onClick={() => setPageOrder(thumbnails.map((th) => th.pageNumber - 1))}
                  className="text-xs font-semibold text-[#C9A227] inline-flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Reset order
                </button>
              </div>

              {loadingThumbs ? (
                <div className="py-8 flex items-center justify-center gap-2 text-sm text-[#6B707B]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Loading page previews...</span>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {pageOrder.map((origIdx, pos) => {
                    const thumb = thumbnails[origIdx];
                    return (
                      <div
                        key={`${origIdx}-${pos}`}
                        className="rounded-2xl border border-[#E2DED4] dark:border-[#232833] bg-[#FAF8F4] dark:bg-[#0D0F14] p-2.5 space-y-2"
                      >
                        {thumb && (
                          <img
                            src={thumb.dataUrl}
                            alt={`Page ${origIdx + 1}`}
                            className="w-full h-28 object-contain rounded-xl bg-white"
                          />
                        )}
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono font-semibold">P.{origIdx + 1}</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => moveReorderPage(pos, -1)}
                              disabled={pos === 0}
                              aria-label="Move earlier"
                              className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 cursor-pointer"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveReorderPage(pos, 1)}
                              disabled={pos === pageOrder.length - 1}
                              aria-label="Move later"
                              className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 cursor-pointer"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => removePageFromOrder(pos)}
                              disabled={pageOrder.length <= 1}
                              aria-label="Remove page"
                              className="p-1.5 rounded-lg text-red-600 hover:bg-red-500/10 disabled:opacity-30 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-2xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200"
            >
              {error}
            </div>
          )}

          <button
            type="button"
            disabled={processing}
            onClick={() => void handleProcess()}
            className="w-full min-h-[50px] rounded-2xl bg-gradient-to-b from-[#1C1E24] to-[#0E1014] dark:from-[#E0BC46] dark:to-[#C59D24] text-white dark:text-[#0B0C0E] px-6 py-3.5 text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-95 transition-opacity disabled:opacity-50 cursor-pointer shadow-sm"
          >
            {processing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{progressText || t.processing}</span>
              </>
            ) : (
              <span>{tool.shortLabel}</span>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
