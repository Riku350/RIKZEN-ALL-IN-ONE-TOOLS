import React, { useRef, useState } from 'react';
import { Camera, FileText, Plus, Upload, X } from 'lucide-react';
import { formatBytes } from '../lib/formatters';
import { useApp } from '../contexts/AppContext';

export interface SelectedUploadItem {
  file: File;
  previewUrl?: string;
}

interface UploadZoneProps {
  accept: string;
  supportedFormats: string[];
  maxSizeMb: number;
  maxFiles?: number;
  maxTotalMb?: number;
  multiple?: boolean;
  allowCamera?: boolean;
  hideFileList?: boolean;
  compactWhenHasFiles?: boolean;
  ctaLabel?: string;
  files: SelectedUploadItem[];
  onFilesSelected: (items: SelectedUploadItem[]) => void;
  onRemoveFile: (index: number) => void;
  errorMessage?: string | null;
}

export const UploadZone: React.FC<UploadZoneProps> = ({
  accept,
  supportedFormats,
  maxSizeMb,
  maxFiles = 50,
  maxTotalMb = 1000,
  multiple = false,
  allowCamera = false,
  hideFileList = false,
  compactWhenHasFiles = false,
  ctaLabel,
  files,
  onFilesSelected,
  onRemoveFile,
  errorMessage,
}) => {
  const { t } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const validateAndAdd = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setLocalError(null);

    const maxBytes = maxSizeMb * 1024 * 1024;
    const maxTotalBytes = maxTotalMb * 1024 * 1024;
    const currentTotal = multiple ? files.reduce((acc, item) => acc + item.file.size, 0) : 0;
    let runningTotal = currentTotal;

    const validItems: SelectedUploadItem[] = [];
    const incoming = Array.from(fileList);

    if (multiple && files.length + incoming.length > maxFiles) {
      setLocalError(`Maximum ${maxFiles} files allowed per batch. Currently ${files.length} selected.`);
    }

    for (const file of incoming) {
      if (multiple && files.length + validItems.length >= maxFiles) {
        break;
      }

      if (maxSizeMb > 0 && file.size > maxBytes) {
        setLocalError(
          `"${file.name}" is too large (${formatBytes(file.size)}). Max per file is ${maxSizeMb} MB.`
        );
        return;
      }

      if (multiple && maxTotalMb > 0 && runningTotal + file.size > maxTotalBytes) {
        setLocalError(
          `Batch size limit (${maxTotalMb} MB) reached. Process current files or remove large ones.`
        );
        break;
      }

      if (accept && accept !== 'image/*') {
        const acceptTokens = accept.split(',').map((s) => s.trim().toLowerCase());
        const fileNameLower = file.name.toLowerCase();
        const mimeLower = file.type.toLowerCase();
        const matches = acceptTokens.some((tok) => {
          if (tok.startsWith('.')) return fileNameLower.endsWith(tok);
          if (tok.endsWith('/*')) return mimeLower.startsWith(tok.replace('/*', '/'));
          return mimeLower === tok;
        });
        if (!matches && file.type) {
          setLocalError(`"${file.name}" isn't a supported format (${supportedFormats.join(', ')}).`);
          return;
        }
      }

      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      validItems.push({ file, previewUrl });
      runningTotal += file.size;
      if (!multiple) break;
    }

    if (validItems.length > 0) {
      if (!multiple) {
        files.forEach((oldItem) => {
          if (oldItem.previewUrl) URL.revokeObjectURL(oldItem.previewUrl);
        });
      }
      onFilesSelected(multiple ? [...files, ...validItems] : validItems);
    }
  };

  const displayError = errorMessage || localError;
  const isCompact = compactWhenHasFiles && files.length > 0;

  return (
    <div className="space-y-4">
      {files.length === 0 || multiple ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            validateAndAdd(e.dataTransfer.files);
          }}
          className={`rikzen-card rounded-3xl border-2 border-dashed transition-all text-center ${
            isCompact ? 'p-5 sm:p-6' : 'p-7 sm:p-11'
          } ${
            isDragging
              ? 'border-[#C9A227] bg-[#C9A227]/8 scale-[0.995]'
              : 'border-[#D8D3C8] dark:border-[#2A2F3B] bg-white dark:bg-[#12151B] hover:border-[#C9A227]/70'
          }`}
        >
          {!isCompact && (
            <div className="mx-auto w-14 h-14 rounded-2xl bg-[#C9A227]/12 border border-[#C9A227]/20 text-[#B88E1E] dark:text-[#D4AF37] flex items-center justify-center mb-4">
              <Plus className="w-7 h-7" />
            </div>
          )}

          <p className={`${isCompact ? 'text-sm' : 'text-lg'} font-bold text-[#111214] dark:text-[#F4F4F0]`}>
            {isCompact ? `+ Add More (${files.length}/${maxFiles})` : t.dropHere}
          </p>

          <div className={`${isCompact ? 'mt-3' : 'mt-5'} flex flex-wrap items-center justify-center gap-3`}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="min-h-[46px] px-6 py-2.5 rounded-2xl bg-gradient-to-b from-[#1C1E24] to-[#0E1014] dark:from-[#E0BC46] dark:to-[#C59D24] text-white dark:text-[#0B0C0E] text-sm font-semibold inline-flex items-center gap-2 hover:opacity-95 transition-all active:scale-[0.98] shadow-sm cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>
                {ctaLabel ||
                  (isCompact
                    ? 'Add More'
                    : multiple
                    ? 'Choose Files'
                    : t.chooseFile)}
              </span>
            </button>

            {allowCamera && (
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="min-h-[46px] px-5 py-2.5 rounded-2xl border border-[#DDD8CE] dark:border-[#2C313D] bg-[#FAF8F4] dark:bg-[#171B22] text-[#111214] dark:text-[#F4F4F0] text-sm font-semibold inline-flex items-center gap-2 hover:border-[#C9A227] transition-colors cursor-pointer"
              >
                <Camera className="w-4 h-4 text-[#C9A227]" />
                <span>{t.takePhoto}</span>
              </button>
            )}
          </div>

          <p className="mt-4 text-xs text-[#6B707B] dark:text-[#9CA0AA] font-medium">
            {supportedFormats.join(', ')} · Max {maxSizeMb} MB/file
            {multiple ? ` · Maximum ${maxFiles} files` : ''}
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept={accept}
            multiple={multiple}
            onChange={(e) => {
              validateAndAdd(e.target.files);
              e.target.value = '';
            }}
            className="hidden"
          />

          {allowCamera && (
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                validateAndAdd(e.target.files);
                e.target.value = '';
              }}
              className="hidden"
            />
          )}
        </div>
      ) : null}

      {displayError && (
        <div
          role="alert"
          className="rounded-2xl border border-amber-300 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm font-medium text-amber-900 dark:text-amber-200"
        >
          {displayError}
        </div>
      )}

      {!hideFileList && files.length > 0 && (
        <div className="space-y-2.5">
          {files.map((item, idx) => (
            <div
              key={`${item.file.name}-${item.file.size}-${idx}`}
              className="rounded-2xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-3.5 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                {item.previewUrl ? (
                  <img
                    src={item.previewUrl}
                    alt={item.file.name}
                    loading="lazy"
                    decoding="async"
                    className="w-14 h-14 rounded-xl object-cover border border-[#E2DED4] dark:border-[#262932] shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-[#F4F1EA] dark:bg-[#191D25] text-[#B88E1E] dark:text-[#D4AF37] flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#111214] dark:text-[#F4F4F0] truncate">
                    {item.file.name}
                  </p>
                  <p className="text-xs font-mono tabular-nums text-[#6B707B] dark:text-[#9CA0AA] mt-0.5">
                    {formatBytes(item.file.size)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRemoveFile(idx)}
                aria-label={`Remove ${item.file.name}`}
                className="min-h-[40px] min-w-[40px] rounded-xl text-[#6B707B] hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center justify-center transition-colors shrink-0 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
