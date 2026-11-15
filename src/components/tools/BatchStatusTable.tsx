import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Loader2,
  Package,
  Play,
  Trash2,
} from 'lucide-react';
import { formatBytes } from '../../lib/formatters';

export type BatchJobStatus = 'ready' | 'queued' | 'processing' | 'done' | 'error';

export interface BatchJobItem {
  id: string;
  fileName: string;
  sizeBytes: number;
  thumbnailUrl?: string;
  detailsText?: string;
  status: BatchJobStatus;
  errorText?: string;
  downloadUrl?: string;
  downloadFileName?: string;
  outputSizeBytes?: number;
}

interface BatchStatusTableProps {
  items: BatchJobItem[];
  processing: boolean;
  zipBusy?: boolean;
  onDownloadItem?: (item: BatchJobItem) => void;
  onDownloadAll?: () => void;
  onRemoveItem?: (id: string) => void;
  onClearAll?: () => void;
  onStartProcessing?: () => void;
  startLabel?: string;
  downloadAllLabel?: string;
  startDisabled?: boolean;
}

export const BatchStatusTable: React.FC<BatchStatusTableProps> = ({
  items,
  processing,
  zipBusy = false,
  onDownloadItem,
  onDownloadAll,
  onRemoveItem,
  onClearAll,
  onStartProcessing,
  startLabel = 'Start Processing',
  downloadAllLabel = 'Download All',
  startDisabled = false,
}) => {
  const completedCount = items.filter((i) => i.status === 'done').length;
  const processingCount = items.filter((i) => i.status === 'processing').length;
  const errorCount = items.filter((i) => i.status === 'error').length;
  const readyOrQueuedCount = items.filter(
    (i) => i.status === 'ready' || i.status === 'queued'
  ).length;
  const totalCount = items.length;
  const percent =
    totalCount > 0 ? Math.round(((completedCount + errorCount) / totalCount) * 100) : 0;
  const allDone =
    totalCount > 0 && !processing && completedCount > 0 && completedCount + errorCount === totalCount;

  return (
    <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] overflow-hidden">
      {/* Header summary & progress bar */}
      <div className="p-4 sm:p-5 border-b border-[#EFECE4] dark:border-[#1E222C] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-extrabold text-[#111214] dark:text-[#F4F4F0] tabular-nums">
                {totalCount} file{totalCount === 1 ? '' : 's'} selected
              </span>
              <span className="text-xs font-mono tabular-nums text-[#6B707B] dark:text-[#9CA0AA]">
                · {completedCount} / {totalCount} completed
                {processingCount > 0 ? ` · ${processingCount} running` : ''}
                {errorCount > 0 ? ` · ${errorCount} failed` : ''}
              </span>
              {allDone && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-xs font-bold">
                  ✓ All Done
                </span>
              )}
            </div>
            <div className="flex items-center gap-2.5">
              <div className="w-48 sm:w-72 h-2 rounded-full bg-[#ECE8DF] dark:bg-[#1F242E] overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#B88E1E] to-[#E5C453] transition-all duration-300"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <span className="text-xs font-mono font-semibold tabular-nums text-[#B88E1E] dark:text-[#D4AF37]">
                {percent}%
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!processing && onClearAll && totalCount > 0 && (
              <button
                type="button"
                onClick={onClearAll}
                className="min-h-[40px] px-3.5 rounded-xl border border-[#DDD8CE] dark:border-[#2C313D] text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
              >
                Clear All
              </button>
            )}

            {onStartProcessing && !processing && readyOrQueuedCount > 0 && (
              <button
                type="button"
                disabled={startDisabled}
                onClick={onStartProcessing}
                className="min-h-[42px] px-4 py-2 rounded-xl bg-gradient-to-b from-[#1C1E24] to-[#0E1014] dark:from-[#E0BC46] dark:to-[#C59D24] text-white dark:text-[#0B0C0E] text-xs font-bold inline-flex items-center gap-1.5 hover:opacity-95 disabled:opacity-50 cursor-pointer shadow-sm"
              >
                <Play className="w-3.5 h-3.5" />
                <span className="sm:hidden">Start</span>
                <span className="hidden sm:inline">{startLabel}</span>
              </button>
            )}

            {completedCount > 0 && onDownloadAll && (
              <button
                type="button"
                disabled={zipBusy || processing}
                onClick={onDownloadAll}
                className="min-h-[42px] px-4 py-2 rounded-xl bg-gradient-to-b from-[#1C1E24] to-[#0E1014] dark:from-[#E0BC46] dark:to-[#C59D24] text-white dark:text-[#0B0C0E] text-xs font-bold inline-flex items-center gap-2 hover:opacity-95 disabled:opacity-50 cursor-pointer shadow-sm"
              >
                {zipBusy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Package className="w-4 h-4" />
                )}
                <span>{zipBusy ? 'Building ZIP...' : downloadAllLabel}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Responsive Table / List */}
      <div className="max-h-[460px] overflow-y-auto divide-y divide-[#EFECE4] dark:divide-[#1E222C]">
        {items.map((item, idx) => (
          <div
            key={item.id}
            className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3 hover:bg-[#FAF8F4] dark:hover:bg-[#161A22] transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <span className="text-xs font-mono tabular-nums text-[#8E939E] w-6 shrink-0">
                {String(idx + 1).padStart(2, '0')}
              </span>
              {item.thumbnailUrl ? (
                <img
                  src={item.thumbnailUrl}
                  alt={item.fileName}
                  loading="lazy"
                  decoding="async"
                  className="w-10 h-10 rounded-lg object-cover border border-[#E2DED4] dark:border-[#232833] bg-white shrink-0"
                />
              ) : (
                <span className="w-10 h-10 rounded-lg bg-[#F4F1EA] dark:bg-[#191D25] text-[#C9A227] flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#111214] dark:text-[#F4F4F0] truncate">
                  {item.fileName}
                </p>
                <p className="text-xs text-[#6B707B] dark:text-[#9CA0AA] truncate font-mono tabular-nums">
                  {formatBytes(item.sizeBytes)}
                  {item.detailsText ? ` · ${item.detailsText}` : ''}
                  {item.outputSizeBytes ? ` → ${formatBytes(item.outputSizeBytes)}` : ''}
                </p>
                {item.errorText && (
                  <p className="text-xs text-red-600 dark:text-red-400 mt-0.5 truncate">
                    {item.errorText}
                  </p>
                )}
              </div>
            </div>

            {/* Status & Action */}
            <div className="flex items-center gap-2 shrink-0">
              {item.status === 'ready' && (
                <span className="text-xs font-medium text-[#6B707B] dark:text-[#9CA0AA]">
                  Ready
                </span>
              )}
              {item.status === 'queued' && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-[#6B707B] dark:text-[#9CA0AA]">
                  <Clock className="w-3.5 h-3.5" />
                  Queued
                </span>
              )}
              {item.status === 'processing' && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#B88E1E] dark:text-[#D4AF37]">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Processing...
                </span>
              )}
              {item.status === 'done' && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Done ✓
                </span>
              )}
              {item.status === 'error' && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Failed
                </span>
              )}

              {item.status === 'done' && item.downloadUrl && onDownloadItem && (
                <button
                  type="button"
                  onClick={() => onDownloadItem(item)}
                  aria-label={`Download ${item.fileName}`}
                  className="min-h-[36px] px-3 rounded-xl border border-[#DDD8CE] dark:border-[#2C313D] bg-white dark:bg-[#191D25] text-xs font-semibold text-[#111214] dark:text-[#F4F4F0] hover:border-[#C9A227] inline-flex items-center gap-1 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-[#C9A227]" />
                  <span className="hidden sm:inline">Save</span>
                </button>
              )}

              {!processing && item.status !== 'processing' && onRemoveItem && (
                <button
                  type="button"
                  onClick={() => onRemoveItem(item.id)}
                  aria-label={`Remove ${item.fileName}`}
                  className="min-h-[36px] min-w-[36px] rounded-xl text-[#8E939E] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center justify-center cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
