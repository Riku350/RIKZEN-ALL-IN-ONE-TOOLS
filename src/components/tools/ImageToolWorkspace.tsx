import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  Image as ImageIcon,
  Loader2,
  RotateCcw,
  Share2,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { ToolDefinition } from '../../lib/toolRegistry';
import { SelectedUploadItem, UploadZone } from '../UploadZone';
import { ImageUrlLoader, LoadedUrlImage } from '../ImageUrlLoader';
import { ProcessedResult, ToolResultCard } from './ToolResultCard';
import { BatchJobItem, BatchStatusTable } from './BatchStatusTable';
import { useAuth } from '../../contexts/AuthContext';
import { useApp } from '../../contexts/AppContext';
import { formatBytes, trackAnalyticsEvent } from '../../lib/formatters';
import {
  DownloadError,
  downloadFileSafely,
  extractSecureTokenFromUrl,
  fetchFileAsBlob,
} from '../../lib/downloadClient';

type InputSourceMode = 'upload' | 'url';

interface BatchImageEntry extends BatchJobItem {
  file: File;
  fileId?: string;
  downloadToken?: string;
  secureToken?: string;
}

interface PassportSheetResult {
  singleUrl: string;
  singleDownloadUrl: string;
  downloadJpgUrl: string;
  previewJpgUrl: string;
  downloadPdfUrl: string;
  jpgFileName: string;
  pdfFileName: string;
  originalSizeBytes: number;
  jpgSizeBytes: number;
  pdfSizeBytes: number;
  cols: number;
  rows: number;
  totalPhotos: number;
  photoWidthMm: number;
  photoHeightMm: number;
  bgRemoved: boolean;
}

export const ImageToolWorkspace: React.FC<{ tool: ToolDefinition }> = ({ tool }) => {
  const { getToken } = useAuth();
  const { t, capabilities, toolConfigs, notify } = useApp();

  const [sourceMode, setSourceMode] = useState<InputSourceMode>('upload');
  const [files, setFiles] = useState<SelectedUploadItem[]>([]);
  const [batchEntries, setBatchEntries] = useState<BatchImageEntry[]>([]);
  const [batchZipBusy, setBatchZipBusy] = useState(false);

  const [quality, setQuality] = useState(80);
  const [format, setFormat] = useState(() => {
    if (tool.id === 'jpg-to-png') return 'png';
    if (tool.id === 'png-to-jpg' || tool.id === 'webp-to-jpg' || tool.id === 'passport-photo') return 'jpg';
    if (tool.id === 'jpg-to-webp') return 'webp';
    return 'auto';
  });
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [lockAspect, setLockAspect] = useState(true);
  const [fit, setFit] = useState('inside');

  // Crop controls (0-100%)
  const [cropX, setCropX] = useState(10);
  const [cropY, setCropY] = useState(10);
  const [cropW, setCropW] = useState(80);
  const [cropH, setCropH] = useState(80);

  // Background Remover & Studio state
  const [bgCutting, setBgCutting] = useState(false);
  const [cutoutFile, setCutoutFile] = useState<File | null>(null);
  const [cutoutPreviewUrl, setCutoutPreviewUrl] = useState<string | null>(null);
  const [bgType, setBgType] = useState<'transparent' | 'color' | 'image'>('transparent');
  const [bgColor, setBgColor] = useState('#ffffff');
  const [bgCustomImageFile, setBgCustomImageFile] = useState<File | null>(null);
  const [bgCustomImageUrl, setBgCustomImageUrl] = useState<string | null>(null);
  const [bgBlur, setBgBlur] = useState(0);
  const [bgOpacity, setBgOpacity] = useState(100);
  const [bgFit, setBgFit] = useState<'contain' | 'cover'>('contain');
  const [bgPosX, setBgPosX] = useState(0);
  const [bgPosY, setBgPosY] = useState(0);
  const [bgScale, setBgScale] = useState(1);
  const bgPreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const bgImageInputRef = useRef<HTMLInputElement>(null);
  const [bgExporting, setBgExporting] = useState<'png' | 'jpg' | null>(null);
  const [bgExportDone, setBgExportDone] = useState<'png' | 'jpg' | null>(null);

  // Passport Studio state
  const [passportPreset, setPassportPreset] = useState<'35x45' | '2x2' | '35x35' | 'custom'>('35x45');
  const [customWidthMm, setCustomWidthMm] = useState(35);
  const [customHeightMm, setCustomHeightMm] = useState(45);
  const [passportBg, setPassportBg] = useState('#ffffff');
  const [autoRemovePassportBg, setAutoRemovePassportBg] = useState(true);
  const [ppZoom, setPpZoom] = useState(1.0);
  const [ppOffsetX, setPpOffsetX] = useState(0);
  const [ppOffsetY, setPpOffsetY] = useState(0);
  const [ppRotation, setPpRotation] = useState(0);
  const [ppBrightness, setPpBrightness] = useState(1.0);
  const [ppContrast, setPpContrast] = useState(1.0);
  const [passportResult, setPassportResult] = useState<PassportSheetResult | null>(null);
  const [ppSingleBlobUrl, setPpSingleBlobUrl] = useState<string | null>(null);
  const [ppSheetBlobUrl, setPpSheetBlobUrl] = useState<string | null>(null);
  const [ppDlBusy, setPpDlBusy] = useState<'jpg' | 'pdf' | null>(null);
  const [ppDlDone, setPpDlDone] = useState<{ jpg?: boolean; pdf?: boolean }>({});
  const [ppDlError, setPpDlError] = useState<string | null>(null);
  const [ppExpired, setPpExpired] = useState(false);

  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProcessedResult | null>(null);

  // Fetch Passport Sheet previews via active SPA session so strict mobile cookie mode displays them cleanly
  useEffect(() => {
    let active = true;
    const urlsToRevoke: string[] = [];

    if (!passportResult) {
      setPpSingleBlobUrl(null);
      setPpSheetBlobUrl(null);
      setPpDlDone({});
      setPpDlError(null);
      setPpExpired(false);
      return;
    }

    void fetchFileAsBlob({ url: passportResult.singleUrl, mimeType: 'image/jpeg' })
      .then((b) => {
        if (!active) return;
        const u = URL.createObjectURL(b);
        urlsToRevoke.push(u);
        setPpSingleBlobUrl(u);
      })
      .catch(() => {});

    void fetchFileAsBlob({ url: passportResult.previewJpgUrl, mimeType: 'image/jpeg' })
      .then((b) => {
        if (!active) return;
        const u = URL.createObjectURL(b);
        urlsToRevoke.push(u);
        setPpSheetBlobUrl(u);
      })
      .catch(() => {});

    return () => {
      active = false;
      urlsToRevoke.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [passportResult]);

  const maxSizeMb = toolConfigs[tool.id]?.maxFileSizeMb || tool.maxSizeMb || capabilities.maxFileSizeMb || 100;
  const maxBatchFiles = capabilities.maxFilesPerBatch || 50;
  const maxBatchMb = capabilities.maxTotalBatchSizeMb || 1000;
  const isBatchImageTool = tool.id !== 'crop-image';

  const revokeItemUrls = (items: SelectedUploadItem[]) => {
    items.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
  };

  const clearAllFiles = () => {
    revokeItemUrls(files);
    setFiles([]);
    setBatchEntries([]);
    setNaturalSize(null);
    setError(null);
  };

  const handleLoadedUrlImage = (loaded: LoadedUrlImage, allowMulti: boolean) => {
    setError(null);
    setBatchEntries([]);
    const newItem: SelectedUploadItem = {
      file: loaded.file,
      previewUrl: loaded.previewUrl,
    };
    if (allowMulti) {
      setFiles((prev) => {
        if (prev.length >= maxBatchFiles) {
          URL.revokeObjectURL(loaded.previewUrl);
          notify(`Maximum ${maxBatchFiles} files allowed per batch.`, 'error');
          return prev;
        }
        return [...prev, newItem];
      });
    } else {
      revokeItemUrls(files);
      setFiles([newItem]);
    }
    setSourceMode('upload');
    void trackAnalyticsEvent('file_uploaded', tool.id, tool.category);
  };

  useEffect(() => {
    setFiles((prev) => {
      revokeItemUrls(prev);
      return [];
    });
    setSourceMode('upload');
    setBatchEntries([]);
    setResult(null);
    setPassportResult(null);
    setError(null);
    setNaturalSize(null);
    setWidth('');
    setHeight('');
    setCutoutFile(null);
    setCutoutPreviewUrl(null);
    setBgType('transparent');
    setBgColor('#ffffff');
    setBgCustomImageFile(null);
    setBgCustomImageUrl(null);
    setBgBlur(0);
    setBgOpacity(100);
    setBgScale(1);
    setBgPosX(0);
    setBgPosY(0);
    if (tool.id === 'jpg-to-png') setFormat('png');
    else if (tool.id === 'png-to-jpg' || tool.id === 'webp-to-jpg' || tool.id === 'passport-photo') setFormat('jpg');
    else if (tool.id === 'jpg-to-webp') setFormat('webp');
    else setFormat('auto');
  }, [tool.id]);

  // Read image natural dimensions when single file uploaded
  useEffect(() => {
    const item = files[0];
    if (!item?.previewUrl) return;
    const img = new Image();
    img.onload = () => {
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
      if (tool.id === 'resize-image') {
        setWidth(String(img.naturalWidth));
        setHeight(String(img.naturalHeight));
      }
    };
    img.src = item.previewUrl;
  }, [files, tool.id]);

  // Auto-run Remove.bg cutout when single file is uploaded on Background Remover (only if configured!)
  useEffect(() => {
    if (tool.id !== 'background-removal' || files.length !== 1) return;
    const uploaded = files[0];
    setCutoutFile(null);
    setCutoutPreviewUrl(null);
    setError(null);

    if (!capabilities.removeBgConfigured) {
      // Honest mode: let user preview/composite transparent PNGs without faking AI removal
      setCutoutFile(uploaded.file);
      setCutoutPreviewUrl(uploaded.previewUrl || null);
      return;
    }

    let cancelled = false;
    (async () => {
      setBgCutting(true);
      try {
        const token = await getToken();
        const form = new FormData();
        form.append('file', uploaded.file);
        const res = await fetch('/api/tools/image/remove-bg', {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          body: form,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Background removal failed.');

        const cutRes = await fetch(data.previewUrl || data.downloadUrl);
        const cutBlob = await cutRes.blob();
        const cutFile = new File([cutBlob], data.fileName || 'cutout.png', { type: 'image/png' });
        const cutUrl = URL.createObjectURL(cutBlob);
        if (!cancelled) {
          setCutoutFile(cutFile);
          setCutoutPreviewUrl(cutUrl);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Background removal failed.');
        }
      } finally {
        if (!cancelled) setBgCutting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [files, tool.id, capabilities.removeBgConfigured, getToken]);

  // Live HTML5 Canvas compositor preview for Background Remover
  useEffect(() => {
    if (tool.id !== 'background-removal' || !cutoutPreviewUrl) return;
    const canvas = bgPreviewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cancelled = false;
    const fgImg = new Image();
    fgImg.crossOrigin = 'anonymous';
    fgImg.onload = () => {
      if (cancelled) return;
      const maxDim = 560;
      const ratio = Math.min(maxDim / fgImg.naturalWidth, maxDim / fgImg.naturalHeight, 1);
      const cw = Math.max(120, Math.round(fgImg.naturalWidth * ratio));
      const ch = Math.max(120, Math.round(fgImg.naturalHeight * ratio));
      canvas.width = cw;
      canvas.height = ch;
      ctx.clearRect(0, 0, cw, ch);

      const drawFg = () => {
        const targetW = cw * bgScale;
        const targetH = ch * bgScale;
        let drawW = targetW;
        let drawH = targetH;
        const fgAspect = fgImg.naturalWidth / fgImg.naturalHeight;
        const boxAspect = targetW / targetH;
        if (bgFit === 'contain') {
          if (fgAspect > boxAspect) drawH = targetW / fgAspect;
          else drawW = targetH * fgAspect;
        } else {
          if (fgAspect > boxAspect) drawW = targetH * fgAspect;
          else drawH = targetW / fgAspect;
        }
        const x = (cw - drawW) / 2 + (bgPosX / 100) * (cw * 0.4);
        const y = (ch - drawH) / 2 + (bgPosY / 100) * (ch * 0.4);
        ctx.drawImage(fgImg, x, y, drawW, drawH);
      };

      if (bgType === 'color') {
        ctx.save();
        ctx.globalAlpha = bgOpacity / 100;
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, cw, ch);
        ctx.restore();
        drawFg();
      } else if (bgType === 'image' && bgCustomImageUrl) {
        const bgImg = new Image();
        bgImg.onload = () => {
          if (cancelled) return;
          ctx.clearRect(0, 0, cw, ch);
          ctx.save();
          ctx.globalAlpha = bgOpacity / 100;
          if (bgBlur > 0) ctx.filter = `blur(${bgBlur}px)`;
          const bgAspect = bgImg.naturalWidth / bgImg.naturalHeight;
          const cAspect = cw / ch;
          let bw = cw;
          let bh = ch;
          if (bgAspect > cAspect) bw = ch * bgAspect;
          else bh = cw / bgAspect;
          ctx.drawImage(bgImg, (cw - bw) / 2, (ch - bh) / 2, bw, bh);
          ctx.restore();
          drawFg();
        };
        bgImg.src = bgCustomImageUrl;
      } else {
        drawFg();
      }
    };
    fgImg.src = cutoutPreviewUrl;

    return () => {
      cancelled = true;
    };
  }, [
    tool.id,
    cutoutPreviewUrl,
    bgType,
    bgColor,
    bgCustomImageUrl,
    bgBlur,
    bgOpacity,
    bgFit,
    bgPosX,
    bgPosY,
    bgScale,
  ]);

  const handleWidthChange = (val: string) => {
    setWidth(val);
    const num = Number(val);
    if (lockAspect && naturalSize && num > 0) {
      setHeight(String(Math.round((num * naturalSize.h) / naturalSize.w)));
    }
  };

  const handleHeightChange = (val: string) => {
    setHeight(val);
    const num = Number(val);
    if (lockAspect && naturalSize && num > 0) {
      setWidth(String(Math.round((num * naturalSize.w) / naturalSize.h)));
    }
  };

  // Helper to upload & process 1 standard image via /api/tools/image/process
  const processSingleImageFile = async (file: File, token: string | null) => {
    const form = new FormData();
    form.append('file', file);
    form.append('toolId', tool.id);
    form.append('toolName', tool.name);
    form.append('quality', String(quality));
    form.append('format', format);

    if (tool.id === 'resize-image') {
      if (width) form.append('width', width);
      if (height) form.append('height', height);
      form.append('fit', fit);
    }

    if (tool.id === 'crop-image' && naturalSize) {
      form.append('cropLeft', String(Math.round((cropX / 100) * naturalSize.w)));
      form.append('cropTop', String(Math.round((cropY / 100) * naturalSize.h)));
      form.append('cropWidth', String(Math.round((cropW / 100) * naturalSize.w)));
      form.append('cropHeight', String(Math.round((cropH / 100) * naturalSize.h)));
    }

    const res = await fetch('/api/tools/image/process', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Image processing failed.');
    return data as {
      fileId: string;
      fileName: string;
      mimeType: string;
      originalSizeBytes: number;
      outputSizeBytes: number;
      width?: number;
      height?: number;
      downloadUrl: string;
      previewUrl?: string;
    };
  };

  const handleProcess = async () => {
    if (files.length === 0) return;
    setError(null);
    setProcessing(true);
    setProgress(15);
    void trackAnalyticsEvent('processing_started', tool.id, tool.category);

    const ticker = setInterval(() => {
      setProgress((p) => (p < 88 ? p + 8 : p));
    }, 180);

    try {
      const token = await getToken();

      // Batch mode when 2+ images are selected
      if (isBatchImageTool && files.length > 1) {
        const queueEntries: BatchImageEntry[] = files.map((item, idx) => ({
          id: `${idx}-${item.file.name}-${item.file.size}`,
          file: item.file,
          fileName: item.file.name,
          sizeBytes: item.file.size,
          thumbnailUrl: item.previewUrl,
          status: 'queued',
        }));
        setBatchEntries(queueEntries);

        const concurrency = Math.min(4, Math.max(1, capabilities.maxConcurrentJobs || 4));
        let cursor = 0;

        const worker = async () => {
          while (cursor < queueEntries.length) {
            const target = queueEntries[cursor++];
            setBatchEntries((prev) =>
              prev.map((e) => (e.id === target.id ? { ...e, status: 'processing' } : e))
            );
            try {
              const out = await processSingleImageFile(target.file, token);
              const secureToken = extractSecureTokenFromUrl(out.downloadUrl) || undefined;
              const tokenParam =
                new URL(out.downloadUrl, window.location.origin).searchParams.get('token') || '';
              setBatchEntries((prev) =>
                prev.map((e) =>
                  e.id === target.id
                    ? {
                        ...e,
                        status: 'done',
                        fileId: out.fileId,
                        downloadToken: tokenParam,
                        secureToken,
                        downloadUrl: out.downloadUrl,
                        downloadFileName: out.fileName,
                        outputSizeBytes: out.outputSizeBytes,
                        detailsText: out.width && out.height ? `${out.width}×${out.height}px` : undefined,
                      }
                    : e
                )
              );
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Failed';
              setBatchEntries((prev) =>
                prev.map((e) =>
                  e.id === target.id ? { ...e, status: 'error', errorText: msg } : e
                )
              );
            }
          }
        };

        await Promise.all(Array.from({ length: concurrency }, () => worker()));
        setProgress(100);
        return;
      }

      // Single file mode
      const data = await processSingleImageFile(files[0].file, token);
      setProgress(100);
      setResult({
        fileName: data.fileName,
        mimeType: data.mimeType,
        originalSizeBytes: data.originalSizeBytes,
        outputSizeBytes: data.outputSizeBytes,
        downloadUrl: data.downloadUrl,
        previewUrl: data.previewUrl,
        extraNote: data.width && data.height ? `${data.width} × ${data.height} px` : undefined,
      });
    } catch (err) {
      const msg =
        err instanceof TypeError
          ? 'Connection problem. Please check your network and retry.'
          : err instanceof Error
          ? err.message
          : 'Something went wrong. Please try again.';
      setError(msg);
    } finally {
      clearInterval(ticker);
      setProcessing(false);
    }
  };

  const handleDownloadAllBatchImages = async () => {
    const done = batchEntries.filter(
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
          archiveName: `rikzen-${tool.id}-${done.length}-images.zip`,
          toolId: tool.id,
          category: 'image',
          items: done.map((d) =>
            d.secureToken
              ? { secureToken: d.secureToken }
              : { fileId: d.fileId, token: d.downloadToken }
          ),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not build ZIP.');
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

  const handleExportBgComposite = async (outFmt: 'png' | 'jpg') => {
    if (!cutoutFile) return;
    setBgExporting(outFmt);
    setBgExportDone(null);
    setError(null);
    try {
      const token = await getToken();
      const form = new FormData();
      form.append('file', cutoutFile);
      form.append('bgType', bgType);
      form.append('bgColor', bgColor);
      if (bgType === 'image' && bgCustomImageFile) {
        form.append('bgImage', bgCustomImageFile);
      }
      form.append('bgBlur', String(bgBlur));
      form.append('bgOpacity', String(bgOpacity));
      form.append('fit', bgFit);
      form.append('posX', String(bgPosX));
      form.append('posY', String(bgPosY));
      form.append('scale', String(bgScale));
      form.append('outputFormat', outFmt);
      form.append('quality', '92');

      const res = await fetch('/api/tools/image/composite-bg', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not export image.');

      await downloadFileSafely({
        url: data.downloadUrl,
        fileName: data.fileName,
        mimeType: outFmt === 'jpg' ? 'image/jpeg' : 'image/png',
      });
      setBgExportDone(outFmt);
      void trackAnalyticsEvent('download_clicked', tool.id, tool.category);
      notify(`Downloaded ${data.fileName} (${formatBytes(data.outputSizeBytes)})`, 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed. Please try again.');
    } finally {
      setBgExporting(null);
    }
  };

  const handleGeneratePassportSheet = async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setError(null);
    void trackAnalyticsEvent('processing_started', tool.id, tool.category);
    try {
      const token = await getToken();

      // Batch Passport Mode (2+ photos)
      if (files.length > 1) {
        const queueEntries: BatchImageEntry[] = files.map((item, idx) => ({
          id: `${idx}-${item.file.name}-${item.file.size}`,
          file: item.file,
          fileName: item.file.name,
          sizeBytes: item.file.size,
          thumbnailUrl: item.previewUrl,
          status: 'queued',
        }));
        setBatchEntries(queueEntries);

        const concurrency = Math.min(4, Math.max(1, capabilities.maxConcurrentJobs || 4));
        let cursor = 0;

        const worker = async () => {
          while (cursor < queueEntries.length) {
            const target = queueEntries[cursor++];
            setBatchEntries((prev) =>
              prev.map((e) => (e.id === target.id ? { ...e, status: 'processing' } : e))
            );
            try {
              const form = new FormData();
              form.append('file', target.file);
              form.append('preset', passportPreset);
              form.append('customWidthMm', String(customWidthMm));
              form.append('customHeightMm', String(customHeightMm));
              form.append('bgColor', passportBg);
              form.append('zoom', String(ppZoom));
              form.append('offsetX', String(ppOffsetX));
              form.append('offsetY', String(ppOffsetY));
              form.append('rotation', String(ppRotation));
              form.append('brightness', String(ppBrightness));
              form.append('contrast', String(ppContrast));
              form.append('autoRemoveBg', String(autoRemovePassportBg));

              const res = await fetch('/api/tools/image/passport-sheet', {
                method: 'POST',
                headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                body: form,
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || 'Sheet creation failed.');
              const secureToken = extractSecureTokenFromUrl(data.downloadPdfUrl) || undefined;
              setBatchEntries((prev) =>
                prev.map((e) =>
                  e.id === target.id
                    ? {
                        ...e,
                        status: 'done',
                        secureToken,
                        downloadUrl: data.downloadPdfUrl,
                        downloadFileName: data.pdfFileName,
                        outputSizeBytes: data.pdfSizeBytes,
                        detailsText: `${data.totalPhotos} photos · A4 PDF`,
                      }
                    : e
                )
              );
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Failed';
              setBatchEntries((prev) =>
                prev.map((e) =>
                  e.id === target.id ? { ...e, status: 'error', errorText: msg } : e
                )
              );
            }
          }
        };

        await Promise.all(Array.from({ length: concurrency }, () => worker()));
        return;
      }

      // Single Passport Mode
      const form = new FormData();
      form.append('file', files[0].file);
      form.append('preset', passportPreset);
      form.append('customWidthMm', String(customWidthMm));
      form.append('customHeightMm', String(customHeightMm));
      form.append('bgColor', passportBg);
      form.append('zoom', String(ppZoom));
      form.append('offsetX', String(ppOffsetX));
      form.append('offsetY', String(ppOffsetY));
      form.append('rotation', String(ppRotation));
      form.append('brightness', String(ppBrightness));
      form.append('contrast', String(ppContrast));
      form.append('autoRemoveBg', String(autoRemovePassportBg));

      const res = await fetch('/api/tools/image/passport-sheet', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create passport photo sheet.');
      setPassportResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create passport sheet.');
    } finally {
      setProcessing(false);
    }
  };

  const handleBatchBackgroundRemoval = async () => {
    if (files.length < 2) return;
    setProcessing(true);
    setError(null);
    void trackAnalyticsEvent('processing_started', tool.id, tool.category);

    const queueEntries: BatchImageEntry[] = files.map((item, idx) => ({
      id: `${idx}-${item.file.name}-${item.file.size}`,
      file: item.file,
      fileName: item.file.name,
      sizeBytes: item.file.size,
      thumbnailUrl: item.previewUrl,
      status: 'queued',
    }));
    setBatchEntries(queueEntries);

    try {
      const token = await getToken();
      const concurrency = Math.min(3, capabilities.maxConcurrentJobs || 4);
      let cursor = 0;

      const worker = async () => {
        while (cursor < queueEntries.length) {
          const target = queueEntries[cursor++];
          setBatchEntries((prev) =>
            prev.map((e) => (e.id === target.id ? { ...e, status: 'processing' } : e))
          );
          try {
            let res: Response;
            if (capabilities.removeBgConfigured) {
              const form = new FormData();
              form.append('file', target.file);
              res = await fetch('/api/tools/image/remove-bg', {
                method: 'POST',
                headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                body: form,
              });
            } else {
              const form = new FormData();
              form.append('file', target.file);
              form.append('bgType', bgType);
              form.append('bgColor', bgColor);
              form.append('outputFormat', 'png');
              res = await fetch('/api/tools/image/composite-bg', {
                method: 'POST',
                headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                body: form,
              });
            }

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Background removal failed.');
            const secureToken = extractSecureTokenFromUrl(data.downloadUrl) || undefined;
            setBatchEntries((prev) =>
              prev.map((e) =>
                e.id === target.id
                  ? {
                      ...e,
                      status: 'done',
                      fileId: data.fileId,
                      secureToken,
                      downloadUrl: data.downloadUrl,
                      downloadFileName: data.fileName,
                      outputSizeBytes: data.outputSizeBytes,
                      detailsText: capabilities.removeBgConfigured ? 'Transparent PNG' : 'Composited PNG',
                    }
                  : e
              )
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed';
            setBatchEntries((prev) =>
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

  // Passport live dimensions helper for sheet preview
  const passportSheetMetrics = useMemo(() => {
    const wMm =
      passportPreset === '2x2' ? 50.8 : passportPreset === '35x35' ? 35 : passportPreset === 'custom' ? customWidthMm : 35;
    const hMm =
      passportPreset === '2x2' ? 50.8 : passportPreset === '35x35' ? 35 : passportPreset === 'custom' ? customHeightMm : 45;
    const cols = Math.max(1, Math.floor((210 - 24 + 4) / (wMm + 4)));
    const rows = Math.max(1, Math.floor((297 - 24 + 4) / (hMm + 4)));
    return { wMm, hMm, cols, rows, total: cols * rows };
  }, [passportPreset, customWidthMm, customHeightMm]);

  if (result) {
    return (
      <ToolResultCard
        result={result}
        onDownloadClick={() => void trackAnalyticsEvent('download_clicked', tool.id, tool.category)}
        onReset={() => {
          setFiles([]);
          setBatchEntries([]);
          setResult(null);
          setError(null);
        }}
      />
    );
  }

  const renderSourceTabs = (allowMulti: boolean) => (
    <div className="space-y-4">
      <div className="inline-flex p-1 rounded-2xl border border-[#E2DED4] dark:border-[#232833] bg-[#F4F1EA] dark:bg-[#12151B]">
        <button
          type="button"
          onClick={() => setSourceMode('upload')}
          className={`min-h-[38px] px-4 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
            sourceMode === 'upload'
              ? 'bg-white dark:bg-[#1E232E] text-[#111214] dark:text-[#F4F4F0] shadow-xs'
              : 'text-[#6B707B] dark:text-[#9CA0AA]'
          }`}
        >
          {allowMulti ? 'Upload Files' : 'Upload File'}
        </button>
        <button
          type="button"
          onClick={() => setSourceMode('url')}
          className={`min-h-[38px] px-4 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
            sourceMode === 'url'
              ? 'bg-white dark:bg-[#1E232E] text-[#111214] dark:text-[#F4F4F0] shadow-xs'
              : 'text-[#6B707B] dark:text-[#9CA0AA]'
          }`}
        >
          🖼️ Image URL
        </button>
      </div>

      {sourceMode === 'upload' ? (
        <UploadZone
          accept={tool.acceptAttr}
          supportedFormats={tool.supportedFormats}
          maxSizeMb={maxSizeMb}
          maxFiles={maxBatchFiles}
          maxTotalMb={maxBatchMb}
          multiple={allowMulti}
          allowCamera
          hideFileList={files.length > 1}
          compactWhenHasFiles={allowMulti && files.length > 0}
          files={files}
          onFilesSelected={(items) => {
            setFiles(items);
            setBatchEntries([]);
            setError(null);
            void trackAnalyticsEvent('file_uploaded', tool.id, tool.category);
          }}
          onRemoveFile={(idx) => {
            setFiles((prev) => {
              const target = prev[idx];
              if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
              return prev.filter((_, i) => i !== idx);
            });
            if (files.length <= 1) setNaturalSize(null);
          }}
        />
      ) : (
        <ImageUrlLoader
          actionLabel={allowMulti && files.length > 0 ? 'Add to Batch' : 'Continue with Image'}
          onUseImage={(loaded) => handleLoadedUrlImage(loaded, allowMulti)}
        />
      )}
    </div>
  );

  // SPECIAL STUDIO 1: BACKGROUND REMOVER + STUDIO (Single Studio & Controlled Batch Queue)
  if (tool.id === 'background-removal') {
    return (
      <div className="space-y-6">
        {!capabilities.removeBgConfigured && (
          <div className="rounded-3xl border border-amber-300 dark:border-amber-800/60 bg-amber-50/85 dark:bg-amber-950/35 p-5 space-y-2">
            <div className="flex items-center gap-2.5 text-amber-900 dark:text-amber-200 font-bold text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>AI Auto-Cutout Requires Backend API Key</span>
            </div>
            <p className="text-xs sm:text-sm text-amber-800 dark:text-amber-300 leading-relaxed">
              Server-side AI background removal uses <code className="font-mono font-semibold">REMOVEBG_API_KEY</code> (not configured on this server, so opaque photos are not faked). You can still upload transparent PNG cutouts (single or batch) to apply solid backgrounds, blur, opacity, scale, and PNG/JPG compositing.
            </p>
          </div>
        )}

        {renderSourceTabs(true)}

        {files.length > 1 && (
          <div className="space-y-4">
            <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-bold text-[#111214] dark:text-[#F4F4F0]">
                  Batch Background Processing ({files.length} images)
                </span>
                <span className="text-xs text-[#6B707B] dark:text-[#9CA0AA]">
                  Controlled queue ({Math.min(3, capabilities.maxConcurrentJobs || 4)} at a time)
                </span>
              </div>

              {!capabilities.removeBgConfigured && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">
                    Fill Transparent Cutouts With:
                  </span>
                  <button
                    type="button"
                    onClick={() => setBgType('transparent')}
                    className={`px-3 py-1.5 rounded-xl border font-semibold cursor-pointer ${
                      bgType === 'transparent'
                        ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] border-transparent'
                        : 'border-[#DDD8CE] dark:border-[#2C313D]'
                    }`}
                  >
                    Keep Transparent
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBgType('color');
                      setBgColor('#ffffff');
                    }}
                    className={`px-3 py-1.5 rounded-xl border font-semibold cursor-pointer ${
                      bgType === 'color' && bgColor === '#ffffff'
                        ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] border-transparent'
                        : 'border-[#DDD8CE] dark:border-[#2C313D]'
                    }`}
                  >
                    White
                  </button>
                  <label className="px-3 py-1 rounded-xl border border-[#DDD8CE] dark:border-[#2C313D] inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="color"
                      value={bgColor}
                      onChange={(e) => {
                        setBgType('color');
                        setBgColor(e.target.value);
                      }}
                      className="w-4 h-4 border-0 bg-transparent cursor-pointer"
                    />
                    <span>Custom</span>
                  </label>
                </div>
              )}
            </div>

            <BatchStatusTable
              items={
                batchEntries.length > 0
                  ? batchEntries
                  : files.map((f, idx) => ({
                      id: `${idx}-${f.file.name}`,
                      fileName: f.file.name,
                      sizeBytes: f.file.size,
                      thumbnailUrl: f.previewUrl,
                      status: 'ready',
                    }))
              }
              processing={processing}
              zipBusy={batchZipBusy}
              startLabel={
                capabilities.removeBgConfigured
                  ? `Remove Background (${files.length})`
                  : `Process Batch (${files.length})`
              }
              onStartProcessing={() => void handleBatchBackgroundRemoval()}
              onClearAll={clearAllFiles}
              onDownloadItem={(item) => {
                if (item.downloadUrl) {
                  void downloadFileSafely({
                    url: item.downloadUrl,
                    fileName: item.downloadFileName || item.fileName,
                  }).catch((err) =>
                    notify(err instanceof Error ? err.message : 'Download failed.', 'error')
                  );
                }
              }}
              onDownloadAll={() => void handleDownloadAllBatchImages()}
              onRemoveItem={(id) => {
                const idx = Number(id.split('-')[0]);
                if (Number.isInteger(idx)) {
                  setFiles((prev) => {
                    const target = prev[idx];
                    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
                    return prev.filter((_, i) => i !== idx);
                  });
                }
                setBatchEntries((prev) => prev.filter((e) => e.id !== id));
              }}
            />
          </div>
        )}

        {files.length === 1 && (
          <div className="space-y-6">
            {/* Two-panel Original vs Preview */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-4 space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-[#5A5D65] dark:text-[#9CA0AA]">
                  <span>ORIGINAL</span>
                  <span className="font-mono">{formatBytes(files[0].file.size)}</span>
                </div>
                <div className="h-72 rounded-2xl bg-[#F4F1EA] dark:bg-[#0D0F14] flex items-center justify-center overflow-hidden p-3">
                  {files[0].previewUrl && (
                    <img
                      src={files[0].previewUrl}
                      alt="Original"
                      className="max-h-full max-w-full object-contain rounded-xl"
                    />
                  )}
                </div>
              </div>

              <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-4 space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-[#B88E1E] dark:text-[#D4AF37]">
                  <span>LIVE PREVIEW</span>
                  <span>
                    {bgCutting
                      ? 'Removing background...'
                      : bgType === 'transparent'
                      ? 'Transparent'
                      : bgType === 'color'
                      ? bgColor.toUpperCase()
                      : 'Custom Image'}
                  </span>
                </div>
                <div
                  className="h-72 rounded-2xl flex items-center justify-center overflow-hidden p-3 border border-[#E2DED4] dark:border-[#232833]"
                  style={{
                    backgroundImage:
                      'linear-gradient(45deg, #e5e2d9 25%, transparent 25%), linear-gradient(-45deg, #e5e2d9 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e2d9 75%), linear-gradient(-45deg, transparent 75%, #e5e2d9 75%)',
                    backgroundSize: '20px 20px',
                    backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
                  }}
                >
                  {bgCutting ? (
                    <div className="flex flex-col items-center gap-2 text-xs font-semibold text-[#111214] bg-white/90 px-4 py-3 rounded-xl">
                      <Loader2 className="w-5 h-5 animate-spin text-[#C9A227]" />
                      <span>Isolating subject...</span>
                    </div>
                  ) : (
                    <canvas
                      ref={bgPreviewCanvasRef}
                      className="max-h-full max-w-full rounded-xl object-contain"
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Background Controls */}
            <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-6 space-y-5">
              <div className="flex items-center gap-2 text-sm font-bold text-[#111214] dark:text-[#F4F4F0]">
                <SlidersHorizontal className="w-4 h-4 text-[#C9A227]" />
                <span>Background & Placement</span>
              </div>

              <div className="space-y-2">
                <span className="text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA] block">
                  Background Fill
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {[
                    { id: 'transparent', label: 'Transparent' },
                    { id: 'white', label: 'White' },
                    { id: 'black', label: 'Black' },
                  ].map((opt) => {
                    const active =
                      (opt.id === 'transparent' && bgType === 'transparent') ||
                      (opt.id === 'white' && bgType === 'color' && bgColor === '#ffffff') ||
                      (opt.id === 'black' && bgType === 'color' && bgColor === '#000000');
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          if (opt.id === 'transparent') setBgType('transparent');
                          else if (opt.id === 'white') {
                            setBgType('color');
                            setBgColor('#ffffff');
                          } else {
                            setBgType('color');
                            setBgColor('#000000');
                          }
                        }}
                        className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold border cursor-pointer ${
                          active
                            ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] border-transparent'
                            : 'border-[#DDD8CE] dark:border-[#2C313D] text-[#5A5D65] dark:text-[#9CA0AA]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}

                  <label className="min-h-[40px] px-3 rounded-xl border border-[#DDD8CE] dark:border-[#2C313D] inline-flex items-center gap-2 text-xs font-semibold cursor-pointer">
                    <input
                      type="color"
                      value={bgColor}
                      onChange={(e) => {
                        setBgType('color');
                        setBgColor(e.target.value);
                      }}
                      className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
                    />
                    <span>Custom Color</span>
                  </label>

                  <button
                    type="button"
                    onClick={() => bgImageInputRef.current?.click()}
                    className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold border inline-flex items-center gap-1.5 cursor-pointer ${
                      bgType === 'image'
                        ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] border-transparent'
                        : 'border-[#DDD8CE] dark:border-[#2C313D] text-[#5A5D65] dark:text-[#9CA0AA]'
                    }`}
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span>{bgCustomImageFile ? 'Change Image' : 'Custom Image'}</span>
                  </button>
                  <input
                    ref={bgImageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setBgCustomImageFile(f);
                        setBgCustomImageUrl(URL.createObjectURL(f));
                        setBgType('image');
                      }
                      e.target.value = '';
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                <label className="space-y-1.5">
                  <div className="flex justify-between">
                    <span className="font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">Background Blur</span>
                    <span className="font-mono text-[#C9A227]">{bgBlur}px</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={30}
                    value={bgBlur}
                    disabled={bgType !== 'image'}
                    onChange={(e) => setBgBlur(Number(e.target.value))}
                    className="w-full accent-[#C9A227]"
                  />
                </label>

                <label className="space-y-1.5">
                  <div className="flex justify-between">
                    <span className="font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">Background Opacity</span>
                    <span className="font-mono text-[#C9A227]">{bgOpacity}%</span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={100}
                    value={bgOpacity}
                    disabled={bgType === 'transparent'}
                    onChange={(e) => setBgOpacity(Number(e.target.value))}
                    className="w-full accent-[#C9A227]"
                  />
                </label>

                <div className="space-y-1.5">
                  <span className="font-semibold text-[#5A5D65] dark:text-[#9CA0AA] block">Fit / Crop</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(['contain', 'cover'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setBgFit(m)}
                        className={`min-h-[36px] rounded-lg font-semibold capitalize border cursor-pointer ${
                          bgFit === m
                            ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] border-transparent'
                            : 'border-[#DDD8CE] dark:border-[#2C313D]'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="space-y-1.5">
                  <div className="flex justify-between">
                    <span className="font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">Scale</span>
                    <span className="font-mono text-[#C9A227]">{Math.round(bgScale * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={40}
                    max={180}
                    value={Math.round(bgScale * 100)}
                    onChange={(e) => setBgScale(Number(e.target.value) / 100)}
                    className="w-full accent-[#C9A227]"
                  />
                </label>

                <label className="space-y-1.5">
                  <div className="flex justify-between">
                    <span className="font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">Position X</span>
                    <span className="font-mono text-[#C9A227]">{bgPosX}%</span>
                  </div>
                  <input
                    type="range"
                    min={-100}
                    max={100}
                    value={bgPosX}
                    onChange={(e) => setBgPosX(Number(e.target.value))}
                    className="w-full accent-[#C9A227]"
                  />
                </label>

                <label className="space-y-1.5">
                  <div className="flex justify-between">
                    <span className="font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">Position Y</span>
                    <span className="font-mono text-[#C9A227]">{bgPosY}%</span>
                  </div>
                  <input
                    type="range"
                    min={-100}
                    max={100}
                    value={bgPosY}
                    onChange={(e) => setBgPosY(Number(e.target.value))}
                    className="w-full accent-[#C9A227]"
                  />
                </label>
              </div>

              {error && (
                <div
                  role="alert"
                  className="rounded-2xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200"
                >
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <button
                  type="button"
                  disabled={!cutoutFile || bgCutting || bgExporting !== null}
                  onClick={() => void handleExportBgComposite('png')}
                  className="min-h-[48px] rounded-2xl bg-gradient-to-b from-[#1C1E24] to-[#0E1014] dark:from-[#E0BC46] dark:to-[#C59D24] text-white dark:text-[#0B0C0E] px-5 py-3 text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-95 disabled:opacity-50 cursor-pointer shadow-sm"
                >
                  {bgExporting === 'png' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Downloading...</span>
                    </>
                  ) : bgExportDone === 'png' ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Downloaded PNG</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      <span>Download PNG</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  disabled={!cutoutFile || bgCutting || bgExporting !== null}
                  onClick={() => void handleExportBgComposite('jpg')}
                  className="min-h-[48px] rounded-2xl border border-[#C9A227]/50 bg-[#C9A227]/10 text-[#111214] dark:text-[#F4F4F0] px-5 py-3 text-sm font-semibold flex items-center justify-center gap-2 hover:bg-[#C9A227]/20 disabled:opacity-50 cursor-pointer"
                >
                  {bgExporting === 'jpg' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-[#C9A227]" />
                      <span>Downloading...</span>
                    </>
                  ) : bgExportDone === 'jpg' ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-600" />
                      <span>Downloaded JPG</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4 text-[#C9A227]" />
                      <span>Download JPG</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setFiles([]);
                    setCutoutFile(null);
                    setCutoutPreviewUrl(null);
                    setError(null);
                  }}
                  className="min-h-[48px] rounded-2xl border border-[#DDD8CE] dark:border-[#2C313D] text-sm font-semibold text-[#5A5D65] dark:text-[#9CA0AA] hover:text-[#111214] dark:hover:text-[#F4F4F0] flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Try Another</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // SPECIAL STUDIO 2: COMPLETE PASSPORT PHOTO WORKFLOW
  if (tool.id === 'passport-photo') {
    if (passportResult) {
      const handlePassportDownload = async (kind: 'jpg' | 'pdf') => {
        if (ppDlBusy || ppExpired) return;
        setPpDlBusy(kind);
        setPpDlError(null);
        void trackAnalyticsEvent('download_clicked', tool.id, tool.category);
        try {
          await downloadFileSafely({
            url: kind === 'jpg' ? passportResult.downloadJpgUrl : passportResult.downloadPdfUrl,
            fileName: kind === 'jpg' ? passportResult.jpgFileName : passportResult.pdfFileName,
            mimeType: kind === 'jpg' ? 'image/jpeg' : 'application/pdf',
          });
          setPpDlDone((prev) => ({ ...prev, [kind]: true }));
        } catch (err) {
          if (err instanceof DownloadError && err.code === 'EXPIRED') {
            setPpExpired(true);
            setPpDlError('This file has expired.');
          } else {
            setPpDlError('Download failed. Please try again.');
          }
        } finally {
          setPpDlBusy(null);
        }
      };

      const handlePassportShare = async () => {
        try {
          const blob = await fetchFileAsBlob({
            url: passportResult.downloadPdfUrl,
            mimeType: 'application/pdf',
          });
          const file = new File([blob], passportResult.pdfFileName, { type: 'application/pdf' });
          if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
            await navigator.share({ title: 'RIKZEN', text: passportResult.pdfFileName, files: [file] });
            return;
          }
          if (navigator.clipboard) {
            await navigator.clipboard.writeText(`${window.location.origin}${passportResult.downloadPdfUrl}`);
            notify('Download link copied to clipboard.', 'success');
            return;
          }
          await handlePassportDownload('pdf');
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') return;
          notify('Use Download JPG or Download PDF to save your sheet.', 'info');
        }
      };

      return (
        <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-6 sm:p-8 space-y-6">
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/8 px-4 py-3.5 flex items-center gap-3.5">
            <span className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </span>
            <div>
              <h3 className="text-base font-bold text-[#111214] dark:text-[#F4F4F0]">
                Ready! A4 Passport Photo Sheet
              </h3>
              <p className="text-xs sm:text-sm text-[#5A5D65] dark:text-[#9CA0AA]">
                {passportResult.totalPhotos} photos ({passportResult.cols} × {passportResult.rows}) · {passportResult.photoWidthMm} × {passportResult.photoHeightMm} mm @ 300 DPI
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-center">
            <div className="rounded-2xl border border-[#E2DED4] dark:border-[#232833] bg-[#FAF8F4] dark:bg-[#0D0F14] p-4 flex flex-col items-center gap-2">
              <span className="text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">Single Photo</span>
              {ppSingleBlobUrl && (
                <img
                  src={ppSingleBlobUrl}
                  alt="Single passport photo"
                  className="max-h-56 rounded-lg shadow-sm border border-[#E2DED4]"
                />
              )}
            </div>
            <div className="rounded-2xl border border-[#E2DED4] dark:border-[#232833] bg-[#FAF8F4] dark:bg-[#0D0F14] p-4 flex flex-col items-center gap-2">
              <span className="text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">Printable A4 Sheet</span>
              {ppSheetBlobUrl && (
                <img
                  src={ppSheetBlobUrl}
                  alt="A4 Printable Sheet"
                  className="max-h-56 rounded-lg shadow-sm border border-[#E2DED4] bg-white"
                />
              )}
            </div>
          </div>

          {ppExpired && (
            <div
              role="alert"
              className="rounded-2xl border border-amber-300 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/40 px-4 py-3.5 flex flex-wrap items-center justify-between gap-3"
            >
              <span className="text-sm font-medium text-amber-900 dark:text-amber-200">
                This file has expired.
              </span>
              <button
                type="button"
                onClick={() => {
                  setFiles([]);
                  setPassportResult(null);
                  setError(null);
                }}
                className="min-h-[38px] px-4 rounded-xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-xs font-semibold cursor-pointer"
              >
                Process Again
              </button>
            </div>
          )}

          {!ppExpired && ppDlError && (
            <div
              role="alert"
              className="rounded-2xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200 flex items-center justify-between gap-3"
            >
              <span>Download failed</span>
              <button
                type="button"
                onClick={() => void handlePassportDownload('pdf')}
                className="text-xs font-bold underline cursor-pointer"
              >
                Try Again
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <button
              type="button"
              disabled={ppDlBusy !== null || ppExpired}
              onClick={() => void handlePassportDownload('pdf')}
              className={`sm:col-span-5 min-h-[50px] rounded-2xl px-5 py-3 text-sm font-semibold flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:opacity-60 ${
                ppDlDone.pdf
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gradient-to-b from-[#1C1E24] to-[#0E1014] dark:from-[#E0BC46] dark:to-[#C59D24] text-white dark:text-[#0B0C0E] hover:opacity-95'
              }`}
            >
              {ppDlBusy === 'pdf' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Downloading...</span>
                </>
              ) : ppDlDone.pdf ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Downloaded PDF</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Download PDF ({formatBytes(passportResult.pdfSizeBytes)})</span>
                </>
              )}
            </button>

            <button
              type="button"
              disabled={ppDlBusy !== null || ppExpired}
              onClick={() => void handlePassportDownload('jpg')}
              className={`sm:col-span-4 min-h-[50px] rounded-2xl border px-5 py-3 text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 ${
                ppDlDone.jpg
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                  : 'border-[#C9A227]/50 bg-[#C9A227]/10 text-[#111214] dark:text-[#F4F4F0] hover:bg-[#C9A227]/20'
              }`}
            >
              {ppDlBusy === 'jpg' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-[#C9A227]" />
                  <span>Downloading...</span>
                </>
              ) : ppDlDone.jpg ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Downloaded JPG</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 text-[#C9A227]" />
                  <span>Download JPG ({formatBytes(passportResult.jpgSizeBytes)})</span>
                </>
              )}
            </button>

            <button
              type="button"
              disabled={ppExpired}
              onClick={() => void handlePassportShare()}
              className="sm:col-span-3 min-h-[50px] rounded-2xl border border-[#DDD8CE] dark:border-[#2C313D] bg-[#FAF8F4] dark:bg-[#171B22] text-[#111214] dark:text-[#F4F4F0] px-4 py-3 text-sm font-semibold flex items-center justify-center gap-2 hover:border-[#C9A227] cursor-pointer disabled:opacity-50"
            >
              <Share2 className="w-4 h-4" />
              <span>Share</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setFiles([]);
              setPassportResult(null);
              setError(null);
            }}
            className="w-full min-h-[44px] rounded-2xl text-sm font-semibold text-[#5A5D65] dark:text-[#9CA0AA] hover:text-[#111214] dark:hover:text-[#F4F4F0] flex items-center justify-center gap-2 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Create Another</span>
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {renderSourceTabs(true)}

        {files.length > 1 && (
          <div className="space-y-5">
            <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-bold text-[#111214] dark:text-[#F4F4F0]">
                  Batch Passport Photos ({files.length} portraits → A4 printable sheets)
                </span>
                <span className="text-xs font-mono text-[#B88E1E] dark:text-[#D4AF37]">
                  {passportSheetMetrics.total} per sheet ({passportSheetMetrics.cols}×{passportSheetMetrics.rows})
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: '35x45', label: '35×45 mm', sub: 'India / EU / UK' },
                  { id: '2x2', label: '2×2 inch', sub: 'US / OCI' },
                  { id: '35x35', label: '35×35 mm', sub: 'Schengen / ID' },
                  { id: 'custom', label: 'Custom Size', sub: 'Millimeters' },
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPassportPreset(p.id as typeof passportPreset)}
                    className={`min-h-[50px] px-2.5 py-2 rounded-xl text-left border transition-colors cursor-pointer ${
                      passportPreset === p.id
                        ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] border-transparent'
                        : 'border-[#DDD8CE] dark:border-[#2C313D] text-[#111214] dark:text-[#F4F4F0]'
                    }`}
                  >
                    <div className="text-xs font-bold">{p.label}</div>
                    <div className="text-[10px] opacity-75">{p.sub}</div>
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {[
                  { color: '#ffffff', label: 'White' },
                  { color: '#dbeafe', label: 'Light Blue' },
                  { color: '#2563eb', label: 'Blue' },
                  { color: '#dc2626', label: 'Red' },
                ].map((bg) => (
                  <button
                    key={bg.color}
                    type="button"
                    onClick={() => setPassportBg(bg.color)}
                    className={`min-h-[38px] px-3.5 rounded-xl text-xs font-semibold border inline-flex items-center gap-2 cursor-pointer ${
                      passportBg.toLowerCase() === bg.color
                        ? 'border-[#C9A227] ring-1 ring-[#C9A227] bg-[#C9A227]/10'
                        : 'border-[#DDD8CE] dark:border-[#2C313D]'
                    }`}
                  >
                    <span
                      className="w-3.5 h-3.5 rounded-full border border-black/15"
                      style={{ backgroundColor: bg.color }}
                    />
                    <span>{bg.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <BatchStatusTable
              items={
                batchEntries.length > 0
                  ? batchEntries
                  : files.map((f, idx) => ({
                      id: `${idx}-${f.file.name}`,
                      fileName: f.file.name,
                      sizeBytes: f.file.size,
                      thumbnailUrl: f.previewUrl,
                      status: 'ready',
                    }))
              }
              processing={processing}
              zipBusy={batchZipBusy}
              startLabel={`Create All (${files.length} Sheets)`}
              onStartProcessing={() => void handleGeneratePassportSheet()}
              onClearAll={clearAllFiles}
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
              onDownloadAll={() => void handleDownloadAllBatchImages()}
              onRemoveItem={(id) => {
                const idx = Number(id.split('-')[0]);
                if (Number.isInteger(idx)) {
                  setFiles((prev) => {
                    const target = prev[idx];
                    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
                    return prev.filter((_, i) => i !== idx);
                  });
                }
                setBatchEntries((prev) => prev.filter((e) => e.id !== id));
              }}
            />
          </div>
        )}

        {files.length === 1 && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Live Interactive Frame Preview + A4 Sheet Layout Preview */}
            <div className="lg:col-span-5 space-y-4">
              <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-5 space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-[#5A5D65] dark:text-[#9CA0AA]">
                  <span>PORTRAIT CROP PREVIEW</span>
                  <span className="font-mono">{passportSheetMetrics.wMm} × {passportSheetMetrics.hMm} mm</span>
                </div>
                <div className="flex justify-center py-2">
                  <div
                    className="relative overflow-hidden rounded-xl border-2 border-[#C9A227] shadow-md flex items-center justify-center"
                    style={{
                      width: `${Math.min(220, Math.round(180 * (passportSheetMetrics.wMm / passportSheetMetrics.hMm)))}px`,
                      height: '210px',
                      backgroundColor: passportBg,
                    }}
                  >
                    {files[0].previewUrl && (
                      <img
                        src={files[0].previewUrl}
                        alt="Passport frame preview"
                        className="w-full h-full object-cover select-none"
                        style={{
                          transform: `translate(${ppOffsetX * 0.45}%, ${ppOffsetY * 0.45}%) scale(${ppZoom}) rotate(${ppRotation}deg)`,
                          filter: `brightness(${ppBrightness}) contrast(${ppContrast})`,
                        }}
                      />
                    )}
                    {/* Subtle head/eye alignment guide */}
                    <div className="pointer-events-none absolute inset-x-[18%] top-[10%] bottom-[16%] rounded-full border border-dashed border-[#C9A227]/60" />
                  </div>
                </div>
              </div>

              {/* A4 Printable Sheet Preview */}
              <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-5 space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-[#5A5D65] dark:text-[#9CA0AA]">
                  <span>A4 PRINT SHEET PREVIEW</span>
                  <span className="font-mono text-[#B88E1E] dark:text-[#D4AF37]">
                    {passportSheetMetrics.total} photos ({passportSheetMetrics.cols}×{passportSheetMetrics.rows})
                  </span>
                </div>
                <div className="mx-auto w-44 aspect-[210/297] rounded-lg border border-[#DDD8CE] bg-white p-2.5 shadow-inner flex flex-col justify-center">
                  <div
                    className="grid gap-1"
                    style={{
                      gridTemplateColumns: `repeat(${passportSheetMetrics.cols}, minmax(0, 1fr))`,
                    }}
                  >
                    {Array.from({ length: passportSheetMetrics.total }).map((_, idx) => (
                      <div
                        key={idx}
                        className="overflow-hidden border border-slate-300"
                        style={{
                          aspectRatio: `${passportSheetMetrics.wMm} / ${passportSheetMetrics.hMm}`,
                          backgroundColor: passportBg,
                        }}
                      >
                        {files[0].previewUrl && (
                          <img
                            src={files[0].previewUrl}
                            alt=""
                            className="w-full h-full object-cover"
                            style={{
                              transform: `translate(${ppOffsetX * 0.45}%, ${ppOffsetY * 0.45}%) scale(${ppZoom}) rotate(${ppRotation}deg)`,
                              filter: `brightness(${ppBrightness}) contrast(${ppContrast})`,
                            }}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Step Controls */}
            <div className="lg:col-span-7 rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-6 space-y-5">
              {/* Auto BG Removal Notice / Toggle */}
              <div className="rounded-2xl border border-[#E2DED4] dark:border-[#232833] bg-[#FAF8F4] dark:bg-[#0D0F14] p-3.5 flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="text-xs font-bold text-[#111214] dark:text-[#F4F4F0] flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#C9A227]" />
                    <span>Auto Background Removal</span>
                  </p>
                  <p className="text-[11px] text-[#6B707B] dark:text-[#9CA0AA]">
                    {capabilities.removeBgConfigured
                      ? 'Automatically isolate portrait onto your chosen background color.'
                      : 'REMOVEBG_API_KEY is not configured — transparent PNGs use the chosen background; JPG portraits crop directly.'}
                  </p>
                </div>
                {capabilities.removeBgConfigured && (
                  <input
                    type="checkbox"
                    checked={autoRemovePassportBg}
                    onChange={(e) => setAutoRemovePassportBg(e.target.checked)}
                    className="accent-[#C9A227] w-4 h-4 mt-0.5 cursor-pointer"
                  />
                )}
              </div>

              {/* Format & Size Presets */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA] block">
                  Passport Format & Size
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: '35x45', label: '35×45 mm', sub: 'India / EU / UK' },
                    { id: '2x2', label: '2×2 inch', sub: 'US / OCI' },
                    { id: '35x35', label: '35×35 mm', sub: 'Schengen / ID' },
                    { id: 'custom', label: 'Custom Size', sub: 'Millimeters' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPassportPreset(p.id as typeof passportPreset)}
                      className={`min-h-[52px] px-2.5 py-2 rounded-xl text-left border transition-colors cursor-pointer ${
                        passportPreset === p.id
                          ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] border-transparent'
                          : 'border-[#DDD8CE] dark:border-[#2C313D] text-[#111214] dark:text-[#F4F4F0]'
                      }`}
                    >
                      <div className="text-xs font-bold">{p.label}</div>
                      <div className="text-[10px] opacity-75">{p.sub}</div>
                    </button>
                  ))}
                </div>

                {passportPreset === 'custom' && (
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <label className="space-y-1">
                      <span className="text-xs text-[#5A5D65]">Width (mm)</span>
                      <input
                        type="number"
                        min={15}
                        max={120}
                        value={customWidthMm}
                        onChange={(e) => setCustomWidthMm(Number(e.target.value))}
                        className="w-full min-h-[40px] rounded-xl border border-[#DDD8CE] dark:border-[#2C313D] bg-[#FAF8F4] dark:bg-[#0D0F14] px-3 text-sm font-mono"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs text-[#5A5D65]">Height (mm)</span>
                      <input
                        type="number"
                        min={15}
                        max={150}
                        value={customHeightMm}
                        onChange={(e) => setCustomHeightMm(Number(e.target.value))}
                        className="w-full min-h-[40px] rounded-xl border border-[#DDD8CE] dark:border-[#2C313D] bg-[#FAF8F4] dark:bg-[#0D0F14] px-3 text-sm font-mono"
                      />
                    </label>
                  </div>
                )}
              </div>

              {/* Background Presets */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA] block">
                  Background Color
                </span>
                <div className="flex flex-wrap gap-2">
                  {[
                    { color: '#ffffff', label: 'White' },
                    { color: '#dbeafe', label: 'Light Blue' },
                    { color: '#2563eb', label: 'Blue' },
                    { color: '#dc2626', label: 'Red' },
                  ].map((bg) => (
                    <button
                      key={bg.color}
                      type="button"
                      onClick={() => setPassportBg(bg.color)}
                      className={`min-h-[38px] px-3.5 rounded-xl text-xs font-semibold border inline-flex items-center gap-2 cursor-pointer ${
                        passportBg.toLowerCase() === bg.color
                          ? 'border-[#C9A227] ring-1 ring-[#C9A227] bg-[#C9A227]/10'
                          : 'border-[#DDD8CE] dark:border-[#2C313D]'
                      }`}
                    >
                      <span
                        className="w-3.5 h-3.5 rounded-full border border-black/15"
                        style={{ backgroundColor: bg.color }}
                      />
                      <span>{bg.label}</span>
                    </button>
                  ))}
                  <label className="min-h-[38px] px-3 rounded-xl border border-[#DDD8CE] dark:border-[#2C313D] inline-flex items-center gap-2 text-xs font-semibold cursor-pointer">
                    <input
                      type="color"
                      value={passportBg}
                      onChange={(e) => setPassportBg(e.target.value)}
                      className="w-4 h-4 border-0 bg-transparent cursor-pointer"
                    />
                    <span>Custom</span>
                  </label>
                </div>
              </div>

              {/* Adjustments */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">
                    Face Positioning & Adjustments
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setPpZoom(1);
                      setPpOffsetX(0);
                      setPpOffsetY(0);
                      setPpRotation(0);
                      setPpBrightness(1);
                      setPpContrast(1);
                    }}
                    className="text-xs font-semibold text-[#C9A227] hover:underline cursor-pointer"
                  >
                    Reset
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  <label className="space-y-1">
                    <div className="flex justify-between">
                      <span>Zoom</span>
                      <span className="font-mono text-[#C9A227]">{ppZoom.toFixed(2)}×</span>
                    </div>
                    <input type="range" min={80} max={220} value={Math.round(ppZoom * 100)} onChange={(e) => setPpZoom(Number(e.target.value) / 100)} className="w-full accent-[#C9A227]" />
                  </label>
                  <label className="space-y-1">
                    <div className="flex justify-between">
                      <span>Horizontal</span>
                      <span className="font-mono text-[#C9A227]">{ppOffsetX}%</span>
                    </div>
                    <input type="range" min={-100} max={100} value={ppOffsetX} onChange={(e) => setPpOffsetX(Number(e.target.value))} className="w-full accent-[#C9A227]" />
                  </label>
                  <label className="space-y-1">
                    <div className="flex justify-between">
                      <span>Vertical</span>
                      <span className="font-mono text-[#C9A227]">{ppOffsetY}%</span>
                    </div>
                    <input type="range" min={-100} max={100} value={ppOffsetY} onChange={(e) => setPpOffsetY(Number(e.target.value))} className="w-full accent-[#C9A227]" />
                  </label>
                  <label className="space-y-1">
                    <div className="flex justify-between">
                      <span>Rotation</span>
                      <span className="font-mono text-[#C9A227]">{ppRotation}°</span>
                    </div>
                    <input type="range" min={-20} max={20} value={ppRotation} onChange={(e) => setPpRotation(Number(e.target.value))} className="w-full accent-[#C9A227]" />
                  </label>
                  <label className="space-y-1">
                    <div className="flex justify-between">
                      <span>Brightness</span>
                      <span className="font-mono text-[#C9A227]">{Math.round(ppBrightness * 100)}%</span>
                    </div>
                    <input type="range" min={65} max={140} value={Math.round(ppBrightness * 100)} onChange={(e) => setPpBrightness(Number(e.target.value) / 100)} className="w-full accent-[#C9A227]" />
                  </label>
                  <label className="space-y-1">
                    <div className="flex justify-between">
                      <span>Contrast</span>
                      <span className="font-mono text-[#C9A227]">{Math.round(ppContrast * 100)}%</span>
                    </div>
                    <input type="range" min={65} max={140} value={Math.round(ppContrast * 100)} onChange={(e) => setPpContrast(Number(e.target.value) / 100)} className="w-full accent-[#C9A227]" />
                  </label>
                </div>
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
                onClick={() => void handleGeneratePassportSheet()}
                className="w-full min-h-[50px] rounded-2xl bg-gradient-to-b from-[#1C1E24] to-[#0E1014] dark:from-[#E0BC46] dark:to-[#C59D24] text-white dark:text-[#0B0C0E] px-6 py-3.5 text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-95 disabled:opacity-50 cursor-pointer shadow-sm"
              >
                {processing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Building A4 Photo Sheet...</span>
                  </>
                ) : (
                  <span>Create Photo Sheet ({passportSheetMetrics.total} on A4)</span>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // STANDARD + BATCH IMAGE TOOLS (Compress, Resize, Crop, Format Conversion, Quality, Strip EXIF)
  const showQuality = ['compress-image', 'image-quality-optimizer', 'jpg-to-webp', 'image-converter'].includes(tool.id);
  const showFormatPicker = ['compress-image', 'image-converter', 'resize-image', 'crop-image', 'image-quality-optimizer'].includes(tool.id);

  return (
    <div className="space-y-6">
      {renderSourceTabs(isBatchImageTool)}

      {files.length > 0 && (
        <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-bold text-[#111214] dark:text-[#F4F4F0]">
              <SlidersHorizontal className="w-4 h-4 text-[#C9A227]" />
              <span>
                Settings {files.length > 1 ? `(${files.length} images selected)` : ''}
              </span>
            </div>
            {naturalSize && files.length === 1 && (
              <span className="text-xs font-mono tabular-nums text-[#6B707B] dark:text-[#9CA0AA]">
                Original: {naturalSize.w} × {naturalSize.h} px
              </span>
            )}
            {files.length > 1 && !processing && (
              <button
                type="button"
                onClick={clearAllFiles}
                className="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline cursor-pointer"
              >
                Clear All
              </button>
            )}
          </div>

          {/* Crop visual preview + percentage sliders */}
          {tool.id === 'crop-image' && files[0]?.previewUrl && (
            <div className="space-y-4">
              <div className="relative rounded-2xl overflow-hidden border border-[#E2DED4] dark:border-[#262932] bg-[#0B0C0E] max-h-80 flex items-center justify-center">
                <div className="relative inline-block">
                  <img
                    src={files[0].previewUrl}
                    alt="Crop preview"
                    className="max-h-72 w-auto block opacity-55"
                  />
                  <div
                    className="absolute border-2 border-[#D4AF37] bg-white/10 pointer-events-none"
                    style={{
                      left: `${cropX}%`,
                      top: `${cropY}%`,
                      width: `${Math.min(100 - cropX, cropW)}%`,
                      height: `${Math.min(100 - cropY, cropH)}%`,
                    }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <label className="space-y-1">
                  <span className="text-[#5A5D65] dark:text-[#9CA0AA]">Left ({cropX}%)</span>
                  <input type="range" min={0} max={90} value={cropX} onChange={(e) => setCropX(Number(e.target.value))} className="w-full accent-[#C9A227]" />
                </label>
                <label className="space-y-1">
                  <span className="text-[#5A5D65] dark:text-[#9CA0AA]">Top ({cropY}%)</span>
                  <input type="range" min={0} max={90} value={cropY} onChange={(e) => setCropY(Number(e.target.value))} className="w-full accent-[#C9A227]" />
                </label>
                <label className="space-y-1">
                  <span className="text-[#5A5D65] dark:text-[#9CA0AA]">Width ({Math.min(100 - cropX, cropW)}%)</span>
                  <input type="range" min={10} max={100 - cropX} value={Math.min(100 - cropX, cropW)} onChange={(e) => setCropW(Number(e.target.value))} className="w-full accent-[#C9A227]" />
                </label>
                <label className="space-y-1">
                  <span className="text-[#5A5D65] dark:text-[#9CA0AA]">Height ({Math.min(100 - cropY, cropH)}%)</span>
                  <input type="range" min={10} max={100 - cropY} value={Math.min(100 - cropY, cropH)} onChange={(e) => setCropH(Number(e.target.value))} className="w-full accent-[#C9A227]" />
                </label>
              </div>
            </div>
          )}

          {/* Resize controls */}
          {tool.id === 'resize-image' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">Width (px)</span>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={width}
                  onChange={(e) => handleWidthChange(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-[#DDD8CE] dark:border-[#2C313D] bg-[#FAF8F4] dark:bg-[#0D0F14] px-3.5 text-sm font-mono tabular-nums"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">Height (px)</span>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={height}
                  onChange={(e) => handleHeightChange(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-[#DDD8CE] dark:border-[#2C313D] bg-[#FAF8F4] dark:bg-[#0D0F14] px-3.5 text-sm font-mono tabular-nums"
                />
              </label>
              <div className="flex flex-col justify-end gap-2">
                <label className="inline-flex items-center gap-2 text-xs font-medium text-[#111214] dark:text-[#F4F4F0] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={lockAspect}
                    onChange={(e) => setLockAspect(e.target.checked)}
                    className="accent-[#C9A227] w-4 h-4"
                  />
                  <span>Lock aspect ratio</span>
                </label>
                <select
                  value={fit}
                  onChange={(e) => setFit(e.target.value)}
                  aria-label="Resize fit mode"
                  className="min-h-[40px] rounded-xl border border-[#DDD8CE] dark:border-[#2C313D] bg-[#FAF8F4] dark:bg-[#0D0F14] px-3 text-xs font-medium"
                >
                  <option value="inside">Fit inside dimensions</option>
                  <option value="cover">Cover & center-crop</option>
                  <option value="fill">Stretch exact</option>
                </select>
              </div>
            </div>
          )}

          {showQuality && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-[#111214] dark:text-[#F4F4F0]">Quality</span>
                <span className="font-mono tabular-nums text-xs font-semibold text-[#C9A227]">
                  {quality}%
                </span>
              </div>
              <input
                type="range"
                min={15}
                max={98}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="w-full accent-[#C9A227]"
              />
            </div>
          )}

          {showFormatPicker && (
            <div className="space-y-2">
              <span className="text-sm font-semibold text-[#111214] dark:text-[#F4F4F0] block">
                Output Format
              </span>
              <div className="flex flex-wrap gap-2">
                {(tool.id === 'image-converter'
                  ? ['jpg', 'png', 'webp', 'avif', 'tiff']
                  : ['auto', 'jpg', 'png', 'webp']
                ).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setFormat(fmt)}
                    className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold uppercase border transition-colors cursor-pointer ${
                      format === fmt
                        ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] border-transparent'
                        : 'border-[#DDD8CE] dark:border-[#2C313D] text-[#5A5D65] dark:text-[#9CA0AA] hover:border-[#C9A227]'
                    }`}
                  >
                    {fmt === 'auto' ? 'Keep Original' : fmt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tool.id === 'image-metadata-removal' && (
            <p className="text-xs text-[#5A5D65] dark:text-[#9CA0AA]">
              Strips EXIF camera details, GPS coordinates, timestamps, and embedded profiles.
            </p>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-2xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200 flex items-center justify-between gap-3"
            >
              <span>{error}</span>
              <button
                type="button"
                onClick={() => void handleProcess()}
                className="text-xs font-bold underline shrink-0 cursor-pointer"
              >
                {t.tryAgain}
              </button>
            </div>
          )}

          <button
            type="button"
            disabled={processing}
            onClick={() => void handleProcess()}
            className="w-full min-h-[50px] rounded-2xl bg-gradient-to-b from-[#1C1E24] to-[#0E1014] dark:from-[#E0BC46] dark:to-[#C59D24] text-white dark:text-[#0B0C0E] px-6 py-3.5 text-sm font-semibold flex items-center justify-center gap-2.5 hover:opacity-95 transition-opacity disabled:opacity-70 cursor-pointer shadow-sm"
          >
            {processing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>
                  {files.length > 1
                    ? `Processing batch (${batchEntries.filter((b) => b.status === 'done').length}/${files.length})...`
                    : `${t.processing} (${progress}%)`}
                </span>
              </>
            ) : (
              <span>
                {files.length > 1
                  ? `Start Processing (${files.length} images)`
                  : tool.shortLabel}
              </span>
            )}
          </button>

          {processing && files.length === 1 && (
            <div className="w-full h-1.5 rounded-full bg-[#ECE8DF] dark:bg-[#22252D] overflow-hidden">
              <div
                className="h-full bg-[#C9A227] transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Batch Status Table for 2+ images */}
      {files.length > 1 && (
        <BatchStatusTable
          items={
            batchEntries.length > 0
              ? batchEntries
              : files.map((f, idx) => ({
                  id: `${idx}-${f.file.name}`,
                  fileName: f.file.name,
                  sizeBytes: f.file.size,
                  thumbnailUrl: f.previewUrl,
                  status: 'ready',
                }))
          }
          processing={processing}
          zipBusy={batchZipBusy}
          startLabel={`Start Processing (${files.length})`}
          onStartProcessing={() => void handleProcess()}
          onClearAll={clearAllFiles}
          onDownloadItem={(item) => {
            if (item.downloadUrl) {
              void trackAnalyticsEvent('download_clicked', tool.id, tool.category);
              void downloadFileSafely({
                url: item.downloadUrl,
                fileName: item.downloadFileName || item.fileName,
              }).catch((err) => {
                notify(
                  err instanceof Error ? err.message : 'Download failed. Please try again.',
                  'error'
                );
              });
            }
          }}
          onDownloadAll={() => void handleDownloadAllBatchImages()}
          onRemoveItem={(id) => {
            const idx = Number(id.split('-')[0]);
            if (Number.isInteger(idx)) {
              setFiles((prev) => {
                const target = prev[idx];
                if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
                return prev.filter((_, i) => i !== idx);
              });
            }
            if (batchEntries.length > 0) {
              setBatchEntries((prev) => prev.filter((e) => e.id !== id));
            }
          }}
        />
      )}
    </div>
  );
};
