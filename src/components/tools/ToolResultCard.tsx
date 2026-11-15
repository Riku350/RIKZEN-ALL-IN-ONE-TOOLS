import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  Eye,
  Loader2,
  RotateCcw,
  Share2,
  X,
} from 'lucide-react';
import { formatBytes } from '../../lib/formatters';
import { useApp } from '../../contexts/AppContext';
import {
  DownloadError,
  downloadFileSafely,
  fetchFileAsBlob,
} from '../../lib/downloadClient';
import { renderPdfPreviewPages } from '../../lib/pdfClient';

export interface SecondaryDownloadAction {
  label: string;
  fileName: string;
  downloadUrl: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface ProcessedResult {
  fileName: string;
  mimeType: string;
  originalSizeBytes: number;
  outputSizeBytes: number;
  downloadUrl: string;
  previewUrl?: string;
  fileBlob?: Blob;
  extraNote?: string;
  primaryLabel?: string;
  resetLabel?: string;
  secondaryActions?: SecondaryDownloadAction[];
}

interface ToolResultCardProps {
  result: ProcessedResult;
  onDownloadClick?: () => void;
  onReset: () => void;
}

type DownloadUiState = 'idle' | 'downloading' | 'downloaded' | 'failed' | 'expired';

export const ToolResultCard: React.FC<ToolResultCardProps> = ({
  result,
  onDownloadClick,
  onReset,
}) => {
  const { t, notify } = useApp();

  const [dlState, setDlState] = useState<DownloadUiState>('idle');
  const [dlErrorMsg, setDlErrorMsg] = useState<string | null>(null);
  const [secondaryBusyLabel, setSecondaryBusyLabel] = useState<string | null>(null);
  const [secondaryDoneLabels, setSecondaryDoneLabels] = useState<Record<string, boolean>>({});
  const [inlineImgUrl, setInlineImgUrl] = useState<string | null>(null);

  // In-app Preview Modal state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewImgUrl, setPreviewImgUrl] = useState<string | null>(null);
  const [previewPdfPages, setPreviewPdfPages] = useState<{ pageNumber: number; dataUrl: string }[]>([]);
  const [previewPdfTotal, setPreviewPdfTotal] = useState(0);
  const [previewText, setPreviewText] = useState<string | null>(null);

  const canPreview =
    result.mimeType.startsWith('image/') ||
    result.mimeType === 'application/pdf' ||
    result.mimeType.startsWith('text/') ||
    result.mimeType === 'application/json';

  // Reset UI states whenever a new processed result arrives
  useEffect(() => {
    setDlState('idle');
    setDlErrorMsg(null);
    setSecondaryBusyLabel(null);
    setSecondaryDoneLabels({});
    setPreviewOpen(false);
  }, [result.downloadUrl, result.fileName]);

  // Fetch inline image preview inside active SPA context so strict mobile cookie partitioning never blocks <img>
  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;

    if (result.previewUrl && result.mimeType.startsWith('image/')) {
      void fetchFileAsBlob({
        url: result.previewUrl,
        mimeType: result.mimeType,
        blob: result.fileBlob,
      })
        .then((blob) => {
          if (!active) return;
          createdUrl = URL.createObjectURL(blob);
          setInlineImgUrl(createdUrl);
        })
        .catch(() => {
          if (active) setInlineImgUrl(null);
        });
    } else {
      setInlineImgUrl(null);
    }

    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [result.previewUrl, result.mimeType, result.fileBlob]);

  // Cleanup preview modal object URL when closed
  useEffect(() => {
    return () => {
      if (previewImgUrl) URL.revokeObjectURL(previewImgUrl);
    };
  }, [previewImgUrl]);

  const savedPercent =
    result.originalSizeBytes > 0 && result.outputSizeBytes < result.originalSizeBytes
      ? Math.round(
          ((result.originalSizeBytes - result.outputSizeBytes) / result.originalSizeBytes) * 100
        )
      : 0;

  const handlePrimaryDownload = async () => {
    if (dlState === 'downloading') return;
    setDlState('downloading');
    setDlErrorMsg(null);
    onDownloadClick?.();

    try {
      await downloadFileSafely({
        url: result.downloadUrl,
        fileName: result.fileName,
        mimeType: result.mimeType,
        blob: result.fileBlob,
      });
      setDlState('downloaded');
    } catch (err) {
      if (err instanceof DownloadError && err.code === 'EXPIRED') {
        setDlState('expired');
        setDlErrorMsg('This file has expired.');
      } else {
        setDlState('failed');
        setDlErrorMsg(
          err instanceof DownloadError ? err.message : 'Download failed. Please try again.'
        );
      }
    }
  };

  const handleSecondaryDownload = async (act: SecondaryDownloadAction) => {
    if (secondaryBusyLabel) return;
    setSecondaryBusyLabel(act.label);
    setDlErrorMsg(null);
    onDownloadClick?.();

    try {
      await downloadFileSafely({
        url: act.downloadUrl,
        fileName: act.fileName,
        mimeType: act.mimeType,
      });
      setSecondaryDoneLabels((prev) => ({ ...prev, [act.label]: true }));
    } catch (err) {
      if (err instanceof DownloadError && err.code === 'EXPIRED') {
        setDlState('expired');
        setDlErrorMsg('This file has expired.');
      } else {
        notify('Download failed. Please try again.', 'error');
      }
    } finally {
      setSecondaryBusyLabel(null);
    }
  };

  const handlePreview = async () => {
    if (!canPreview) return;
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewPdfPages([]);
    setPreviewText(null);
    if (previewImgUrl) {
      URL.revokeObjectURL(previewImgUrl);
      setPreviewImgUrl(null);
    }

    try {
      const targetUrl = result.previewUrl || result.downloadUrl;
      const blob = await fetchFileAsBlob({
        url: targetUrl,
        mimeType: result.mimeType,
        blob: result.fileBlob,
      });

      if (result.mimeType.startsWith('image/')) {
        setPreviewImgUrl(URL.createObjectURL(blob));
      } else if (result.mimeType === 'application/pdf') {
        const rendered = await renderPdfPreviewPages(blob, 8);
        setPreviewPdfPages(rendered.pages);
        setPreviewPdfTotal(rendered.totalPages);
      } else {
        const txt = await blob.text();
        setPreviewText(txt.slice(0, 40000));
      }
    } catch (err) {
      if (err instanceof DownloadError && err.code === 'EXPIRED') {
        setDlState('expired');
        setPreviewError('This file has expired.');
      } else {
        setPreviewError('Could not load preview. Try downloading the file directly.');
      }
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleShare = async () => {
    try {
      const blob = await fetchFileAsBlob({
        url: result.downloadUrl,
        mimeType: result.mimeType,
        blob: result.fileBlob,
      });
      const file = new File([blob], result.fileName, {
        type: result.mimeType || blob.type || 'application/octet-stream',
      });

      if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: 'RIKZEN',
          text: result.fileName,
          files: [file],
        });
        return;
      }

      if (!result.downloadUrl.startsWith('blob:') && navigator.clipboard) {
        const shareTarget = result.downloadUrl.startsWith('http')
          ? result.downloadUrl
          : `${window.location.origin}${result.downloadUrl}`;
        await navigator.clipboard.writeText(shareTarget);
        notify('Download link copied to clipboard.', 'success');
        return;
      }

      // Direct save fallback if Web Share and link copy aren't applicable
      await handlePrimaryDownload();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (err instanceof DownloadError && err.code === 'EXPIRED') {
        setDlState('expired');
        setDlErrorMsg('This file has expired.');
        return;
      }
      notify('Sharing is not supported on this browser. Use Download instead.', 'info');
    }
  };

  return (
    <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-6 sm:p-8 space-y-6">
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/8 px-4 py-3.5 flex items-center gap-3.5">
        <span className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-bold text-[#111214] dark:text-[#F4F4F0]">
            Ready!
          </h3>
          <p className="text-xs sm:text-sm text-[#5A5D65] dark:text-[#9CA0AA] truncate">
            {result.fileName}
          </p>
        </div>
      </div>

      {inlineImgUrl && (
        <div className="rounded-2xl border border-[#E2DED4] dark:border-[#232833] bg-[#F4F1EA] dark:bg-[#0D0F14] p-4 flex items-center justify-center overflow-hidden">
          <img
            src={inlineImgUrl}
            alt={result.fileName}
            className="max-h-72 w-auto rounded-xl object-contain shadow-sm"
          />
        </div>
      )}

      <div className="rounded-2xl border border-[#E2DED4] dark:border-[#232833] bg-[#FAF8F4] dark:bg-[#0E1117] px-5 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 font-mono tabular-nums text-base sm:text-lg font-semibold text-[#111214] dark:text-[#F4F4F0]">
          {result.originalSizeBytes > 0 ? (
            <>
              <span className="text-[#6B707B] dark:text-[#9CA0AA]">
                {formatBytes(result.originalSizeBytes)}
              </span>
              <span aria-hidden="true" className="text-[#C9A227]">
                →
              </span>
              <span>{formatBytes(result.outputSizeBytes)}</span>
            </>
          ) : (
            <span>{formatBytes(result.outputSizeBytes)}</span>
          )}
        </div>
        {savedPercent > 0 && (
          <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
            {savedPercent}% smaller
          </span>
        )}
        {result.extraNote && (
          <span className="text-xs font-medium text-[#5A5D65] dark:text-[#9CA0AA]">
            {result.extraNote}
          </span>
        )}
      </div>

      {/* Expired / Error recovery notice */}
      {dlState === 'expired' && (
        <div
          role="alert"
          className="rounded-2xl border border-amber-300 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/40 px-4 py-3.5 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2.5 text-sm font-medium text-amber-900 dark:text-amber-200">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>This file has expired.</span>
          </div>
          <button
            type="button"
            onClick={onReset}
            className="min-h-[38px] px-4 rounded-xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-xs font-semibold cursor-pointer"
          >
            Process Again
          </button>
        </div>
      )}

      {dlState === 'failed' && dlErrorMsg && (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-3.5 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2.5 text-sm font-medium text-red-800 dark:text-red-200">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Download failed</span>
          </div>
          <button
            type="button"
            onClick={() => void handlePrimaryDownload()}
            className="min-h-[38px] px-4 rounded-xl bg-red-600 text-white text-xs font-semibold cursor-pointer"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Primary Action Row: Download, Preview (separate), Share */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
        <button
          type="button"
          disabled={dlState === 'downloading' || dlState === 'expired'}
          onClick={() => void handlePrimaryDownload()}
          className={`min-h-[50px] rounded-2xl px-6 py-3 text-sm font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-sm cursor-pointer disabled:opacity-60 ${
            canPreview ? 'sm:col-span-6' : 'sm:col-span-8'
          } ${
            dlState === 'downloaded'
              ? 'bg-emerald-600 text-white'
              : 'bg-gradient-to-b from-[#1C1E24] to-[#0E1014] dark:from-[#E0BC46] dark:to-[#C59D24] text-white dark:text-[#0B0C0E] hover:opacity-95'
          }`}
        >
          {dlState === 'downloading' ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Downloading...</span>
            </>
          ) : dlState === 'downloaded' ? (
            <>
              <Check className="w-4 h-4" />
              <span>Downloaded</span>
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              <span>{result.primaryLabel || t.download}</span>
            </>
          )}
        </button>

        {canPreview && (
          <button
            type="button"
            disabled={dlState === 'expired'}
            onClick={() => void handlePreview()}
            className="sm:col-span-3 min-h-[50px] rounded-2xl border border-[#DDD8CE] dark:border-[#2C313D] bg-[#FAF8F4] dark:bg-[#171B22] text-[#111214] dark:text-[#F4F4F0] px-4 py-3 text-sm font-semibold flex items-center justify-center gap-2 hover:border-[#C9A227] transition-colors cursor-pointer disabled:opacity-50"
          >
            <Eye className="w-4 h-4 text-[#C9A227]" />
            <span>Preview</span>
          </button>
        )}

        <button
          type="button"
          disabled={dlState === 'expired'}
          onClick={() => void handleShare()}
          className={`${
            canPreview ? 'sm:col-span-3' : 'sm:col-span-4'
          } min-h-[50px] rounded-2xl border border-[#DDD8CE] dark:border-[#2C313D] bg-[#FAF8F4] dark:bg-[#171B22] text-[#111214] dark:text-[#F4F4F0] px-4 py-3 text-sm font-semibold flex items-center justify-center gap-2 hover:border-[#C9A227] transition-colors cursor-pointer disabled:opacity-50`}
        >
          <Share2 className="w-4 h-4" />
          <span>{t.share}</span>
        </button>
      </div>

      {result.secondaryActions && result.secondaryActions.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {result.secondaryActions.map((act) => {
            const isBusy = secondaryBusyLabel === act.label;
            const isDone = Boolean(secondaryDoneLabels[act.label]);
            return (
              <button
                key={act.label}
                type="button"
                disabled={Boolean(secondaryBusyLabel) || dlState === 'expired'}
                onClick={() => void handleSecondaryDownload(act)}
                className="flex-1 min-w-[180px] min-h-[46px] rounded-2xl border border-[#C9A227]/45 bg-[#C9A227]/8 text-[#111214] dark:text-[#F4F4F0] px-4 py-2.5 text-sm font-semibold flex items-center justify-center gap-2 hover:bg-[#C9A227]/15 transition-colors cursor-pointer disabled:opacity-60"
              >
                {isBusy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#C9A227]" />
                    <span>Downloading...</span>
                  </>
                ) : isDone ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span>Downloaded</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 text-[#C9A227]" />
                    <span>{act.label}</span>
                    {act.sizeBytes ? (
                      <span className="text-xs font-mono opacity-75">
                        ({formatBytes(act.sizeBytes)})
                      </span>
                    ) : null}
                  </>
                )}
              </button>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={onReset}
        className="w-full min-h-[44px] rounded-2xl text-sm font-semibold text-[#5A5D65] dark:text-[#9CA0AA] hover:text-[#111214] dark:hover:text-[#F4F4F0] hover:bg-[#F4F1EA] dark:hover:bg-[#171B22] flex items-center justify-center gap-2 transition-colors cursor-pointer"
      >
        <RotateCcw className="w-4 h-4" />
        <span>{result.resetLabel || t.processAnother}</span>
      </button>

      {/* In-app Preview Modal (works cleanly on mobile Chrome & desktop without opening auth-cookie tabs) */}
      {previewOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Preview ${result.fileName}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        >
          <div className="w-full max-w-3xl max-h-[88vh] rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-5 py-4 border-b border-[#EFECE4] dark:border-[#1E222C] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#111214] dark:text-[#F4F4F0] truncate">
                  {result.fileName}
                </p>
                <p className="text-xs font-mono text-[#6B707B] dark:text-[#9CA0AA]">
                  {formatBytes(result.outputSizeBytes)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void handlePrimaryDownload()}
                  className="min-h-[38px] px-4 rounded-xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{t.download}</span>
                </button>
                <button
                  type="button"
                  aria-label="Close preview"
                  onClick={() => setPreviewOpen(false)}
                  className="min-h-[38px] min-w-[38px] rounded-xl border border-[#DDD8CE] dark:border-[#2C313D] flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-[#F4F1EA] dark:bg-[#0B0D11]">
              {previewLoading ? (
                <div className="py-16 flex flex-col items-center justify-center gap-3 text-sm text-[#5A5D65] dark:text-[#9CA0AA]">
                  <Loader2 className="w-6 h-6 animate-spin text-[#C9A227]" />
                  <span>Loading preview...</span>
                </div>
              ) : previewError ? (
                <div className="py-12 text-center space-y-3">
                  <p className="text-sm font-medium text-[#5A5D65] dark:text-[#9CA0AA]">
                    {previewError}
                  </p>
                </div>
              ) : previewImgUrl ? (
                <div className="flex justify-center">
                  <img
                    src={previewImgUrl}
                    alt={result.fileName}
                    className="max-w-full max-h-[68vh] rounded-2xl object-contain shadow"
                  />
                </div>
              ) : previewPdfPages.length > 0 ? (
                <div className="space-y-4">
                  {previewPdfPages.map((pg) => (
                    <div key={pg.pageNumber} className="space-y-1.5 text-center">
                      <img
                        src={pg.dataUrl}
                        alt={`Page ${pg.pageNumber}`}
                        className="mx-auto max-w-full rounded-xl border border-[#E2DED4] dark:border-[#232833] shadow-sm bg-white"
                      />
                      <span className="text-[11px] font-mono text-[#6B707B] dark:text-[#9CA0AA]">
                        Page {pg.pageNumber} of {previewPdfTotal}
                      </span>
                    </div>
                  ))}
                  {previewPdfTotal > previewPdfPages.length && (
                    <p className="text-center text-xs text-[#6B707B] dark:text-[#9CA0AA] pt-2">
                      Showing first {previewPdfPages.length} of {previewPdfTotal} pages. Download the PDF to view all pages.
                    </p>
                  )}
                </div>
              ) : previewText !== null ? (
                <pre className="whitespace-pre-wrap break-words text-xs font-mono text-[#111214] dark:text-[#F4F4F0] bg-white dark:bg-[#12151B] p-4 rounded-2xl border border-[#E2DED4] dark:border-[#232833]">
                  {previewText}
                </pre>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
