import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Image as ImageIcon,
  Link2,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { formatBytes } from '../lib/formatters';
import { fetchFileAsBlob } from '../lib/downloadClient';

export interface LoadedUrlImage {
  file: File;
  previewUrl: string;
  originalUrl: string;
  finalUrl: string;
  fileName: string;
  mimeType: string;
  format: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface LoadedUrlMeta {
  originalUrl: string;
  finalUrl: string;
  previewUrl: string;
  fileName: string;
  mimeType: string;
  format: string;
  width: number;
  height: number;
  sizeBytes: number;
}

interface ImageUrlLoaderProps {
  onUseImage?: (loaded: LoadedUrlImage) => void;
  onUrlValidated?: (meta: LoadedUrlMeta, blob: Blob) => void;
  actionLabel?: string;
  autoApply?: boolean;
  compact?: boolean;
}

export const ImageUrlLoader: React.FC<ImageUrlLoaderProps> = ({
  onUseImage,
  onUrlValidated,
  actionLabel = 'Use This Image',
  autoApply = false,
  compact = false,
}) => {
  const { getToken } = useAuth();
  const [urlInput, setUrlInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorHeadline, setErrorHeadline] = useState<string | null>(null);
  const [errorSub, setErrorSub] = useState<string | null>(null);

  const [loadedState, setLoadedState] = useState<{
    meta: LoadedUrlMeta;
    blob: Blob;
    blobUrl: string;
  } | null>(null);

  const activeBlobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
        activeBlobUrlRef.current = null;
      }
    };
  }, []);

  const clearPreview = () => {
    if (activeBlobUrlRef.current) {
      URL.revokeObjectURL(activeBlobUrlRef.current);
      activeBlobUrlRef.current = null;
    }
    setLoadedState(null);
    setErrorHeadline(null);
    setErrorSub(null);
  };

  const handleLoadImage = async () => {
    const trimmed = urlInput.trim();
    setErrorHeadline(null);
    setErrorSub(null);

    if (!trimmed) {
      setErrorHeadline("Couldn't load this image");
      setErrorSub('Paste a valid https:// image link and try again.');
      return;
    }

    const lower = trimmed.toLowerCase();
    if (!lower.startsWith('http://') && !lower.startsWith('https://')) {
      setErrorHeadline("Couldn't load this image");
      setErrorSub('Only http:// and https:// URLs are allowed. Try another URL.');
      return;
    }

    clearPreview();
    setLoading(true);

    try {
      const token = await getToken();
      const res = await fetch('/api/tools/image/fetch-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ url: trimmed }),
      });

      const data = await res.json();
      if (!res.ok || !data?.ok) {
        if (data?.code === 'UNSAFE_URL') {
          setErrorHeadline('URL not allowed for security reasons');
          setErrorSub(data.error || 'Try another public http:// or https:// image URL.');
        } else {
          setErrorHeadline("Couldn't load this image");
          setErrorSub('Try another URL');
        }
        return;
      }

      const blob = await fetchFileAsBlob({
        url: data.previewUrl || data.downloadUrl,
        mimeType: data.mimeType,
      });

      const blobUrl = URL.createObjectURL(blob);
      activeBlobUrlRef.current = blobUrl;

      const meta: LoadedUrlMeta = {
        originalUrl: data.originalUrl || trimmed,
        finalUrl: data.finalUrl || trimmed,
        previewUrl: blobUrl,
        fileName: data.fileName || 'image.jpg',
        mimeType: data.mimeType || blob.type || 'image/jpeg',
        format: data.format || 'IMG',
        width: Number(data.width || 0),
        height: Number(data.height || 0),
        sizeBytes: Number(data.sizeBytes || blob.size),
      };

      if (onUrlValidated) {
        onUrlValidated(meta, blob);
      }

      if (autoApply && onUseImage) {
        const file = new File([blob], meta.fileName, { type: meta.mimeType });
        const handoffUrl = URL.createObjectURL(file);
        onUseImage({
          file,
          previewUrl: handoffUrl,
          originalUrl: meta.originalUrl,
          finalUrl: meta.finalUrl,
          fileName: meta.fileName,
          mimeType: meta.mimeType,
          format: meta.format,
          width: meta.width,
          height: meta.height,
          sizeBytes: meta.sizeBytes,
        });
        setUrlInput('');
        if (activeBlobUrlRef.current) {
          URL.revokeObjectURL(activeBlobUrlRef.current);
          activeBlobUrlRef.current = null;
        }
        setLoadedState(null);
      } else {
        setLoadedState({ meta, blob, blobUrl });
      }
    } catch {
      setErrorHeadline("Couldn't load this image");
      setErrorSub('Try another URL');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmUse = () => {
    if (!loadedState || !onUseImage) return;
    const { meta, blob } = loadedState;
    const file = new File([blob], meta.fileName, { type: meta.mimeType });
    const handoffUrl = URL.createObjectURL(file);
    onUseImage({
      file,
      previewUrl: handoffUrl,
      originalUrl: meta.originalUrl,
      finalUrl: meta.finalUrl,
      fileName: meta.fileName,
      mimeType: meta.mimeType,
      format: meta.format,
      width: meta.width,
      height: meta.height,
      sizeBytes: meta.sizeBytes,
    });
    setUrlInput('');
    clearPreview();
  };

  return (
    <div
      className={`rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] ${
        compact ? 'p-4' : 'p-5 sm:p-6'
      } space-y-4`}
    >
      <div className="space-y-1.5">
        <label className="text-sm font-bold text-[#111214] dark:text-[#F4F4F0] flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-[#C9A227]/15 text-[#B88E1E] dark:text-[#D4AF37] flex items-center justify-center">
            <ImageIcon className="w-4 h-4" />
          </span>
          <span>Paste Image URL</span>
        </label>
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Link2 className="w-4 h-4 text-[#8E939E] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="url"
              value={urlInput}
              onChange={(e) => {
                setUrlInput(e.target.value);
                if (errorHeadline) {
                  setErrorHeadline(null);
                  setErrorSub(null);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleLoadImage();
                }
              }}
              placeholder="https://example.com/photo.jpg"
              className="w-full min-h-[46px] rounded-2xl border border-[#DAD4C7] dark:border-[#2B303C] bg-[#FAF8F4] dark:bg-[#0D1015] pl-10 pr-3.5 text-sm text-[#111214] dark:text-[#F4F4F0] focus:outline-none focus:border-[#C9A227]"
            />
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void handleLoadImage()}
            className="min-h-[46px] px-5 rounded-2xl bg-gradient-to-b from-[#1C1E24] to-[#0E1014] dark:from-[#E0BC46] dark:to-[#C59D24] text-white dark:text-[#0B0C0E] text-sm font-semibold inline-flex items-center justify-center gap-2 hover:opacity-95 disabled:opacity-60 cursor-pointer shrink-0 shadow-sm"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Loading...</span>
              </>
            ) : (
              <span>Load Image</span>
            )}
          </button>
        </div>
        <p className="text-[11px] text-[#6B707B] dark:text-[#9CA0AA]">
          Supports JPG, JPEG, PNG, WebP, and GIF image links
        </p>
      </div>

      {errorHeadline && (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/35 px-4 py-3 flex items-start gap-2.5 text-red-800 dark:text-red-200"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="text-xs sm:text-sm">
            <p className="font-bold">{errorHeadline}</p>
            {errorSub && <p className="opacity-90 mt-0.5">{errorSub}</p>}
          </div>
        </div>
      )}

      {loadedState && (
        <div className="rounded-2xl border border-[#C9A227]/45 bg-[#FAF8F4] dark:bg-[#0D1015] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <img
              src={loadedState.blobUrl}
              alt={loadedState.meta.fileName}
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl object-cover border border-[#E2DED4] dark:border-[#262B37] bg-white shrink-0"
            />
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-md bg-[#C9A227]/15 text-[#9A7410] dark:text-[#D4AF37] text-[10px] font-bold uppercase">
                  {loadedState.meta.format}
                </span>
                <p className="text-sm font-bold text-[#111214] dark:text-[#F4F4F0] truncate">
                  {loadedState.meta.fileName}
                </p>
              </div>
              <p className="text-xs font-mono tabular-nums text-[#6B707B] dark:text-[#9CA0AA]">
                {loadedState.meta.width} × {loadedState.meta.height} px ·{' '}
                {formatBytes(loadedState.meta.sizeBytes)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={clearPreview}
              className="min-h-[40px] px-3 rounded-xl border border-[#DAD4C7] dark:border-[#2B303C] text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA] inline-flex items-center gap-1.5 cursor-pointer hover:border-[#C9A227]"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Change</span>
            </button>
            {onUseImage && (
              <button
                type="button"
                onClick={handleConfirmUse}
                className="min-h-[40px] px-4 rounded-xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer hover:opacity-95"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{actionLabel}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
