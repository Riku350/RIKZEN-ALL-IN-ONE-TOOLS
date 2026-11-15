import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Film,
  Image as ImageIcon,
  Lock,
  Mail,
  MapPin,
  Phone,
  Share2,
  UserPlus,
  Wifi,
  X,
} from 'lucide-react';
import { downloadFileSafely, triggerBlobSave } from '../lib/downloadClient';
import { formatBytes } from '../lib/formatters';
import { useApp } from '../contexts/AppContext';
import { RikzenLogo } from '../components/RikzenLogo';
import { QrContentType } from '../lib/qrRenderer';

interface PublicQrRecord {
  shareId: string;
  name: string;
  qrType: QrContentType;
  payload: string;
  shareUrl: string;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  hasThumbnail: boolean;
  mediaUrl: string | null;
  downloadUrl: string | null;
  thumbnailUrl: string | null;
  expiresAt: number | null;
  createdAt: number;
}

function formatDuration(sec?: number | null): string {
  if (!sec || !Number.isFinite(sec)) return '';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function isSafeHttpUrl(val: string): boolean {
  try {
    const u = new URL(val);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export const QrContentPage: React.FC<{
  shareId: string;
  onNavigate: (path: string) => void;
}> = ({ shareId, onNavigate }) => {
  const { notify } = useApp();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'ok' | 'expired' | 'not_found' | 'error'>('ok');
  const [record, setRecord] = useState<PublicQrRecord | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [zoomImage, setZoomImage] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/qr/public/${encodeURIComponent(shareId)}`, { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        if (res.status === 410 || json.code === 'QR_EXPIRED') {
          setStatus('expired');
          return;
        }
        if (res.status === 404 || json.code === 'QR_NOT_FOUND' || !res.ok || !json.record) {
          setStatus('not_found');
          return;
        }
        setRecord(json.record as PublicQrRecord);
        setStatus('ok');
      })
      .catch(() => {
        if (active) setStatus('error');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [shareId]);

  const handleDownloadMedia = async () => {
    if (!record?.downloadUrl) return;
    setDownloading(true);
    try {
      await downloadFileSafely({
        url: record.downloadUrl,
        fileName: record.fileName || `rikzen-${record.shareId}`,
        mimeType: record.mimeType || undefined,
      });
      notify('File downloaded.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Download failed.', 'error');
    } finally {
      setDownloading(false);
    }
  };

  const handleSharePage = async () => {
    const shareTarget = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: record?.name || 'RIKZEN Shared Content',
          url: shareTarget,
        });
        return;
      } catch {
        // fallback to clipboard
      }
    }
    await navigator.clipboard?.writeText(shareTarget);
    notify('Share link copied.', 'success');
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-14 space-y-5">
        <div className="h-10 w-44 rounded-2xl bg-[#EAE6DC] dark:bg-[#1B1E26] animate-pulse mx-auto" />
        <div className="h-72 rounded-3xl bg-[#EAE6DC] dark:bg-[#1B1E26] animate-pulse" />
      </div>
    );
  }

  if (status === 'expired') {
    return (
      <div className="max-w-lg mx-auto px-4 sm:px-6 py-16 text-center">
        <div className="rikzen-card rounded-3xl border border-amber-300/70 dark:border-amber-800/60 bg-white dark:bg-[#12151B] p-8 space-y-4">
          <span className="w-14 h-14 rounded-2xl bg-amber-500/12 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
            <Clock className="w-7 h-7" />
          </span>
          <h1 className="text-xl font-extrabold text-[#111214] dark:text-[#F4F4F0]">
            This QR content has expired.
          </h1>
          <p className="text-sm text-[#5A5D65] dark:text-[#9CA0AA]">
            The creator set an expiration window on this shared QR item, and its files have been removed.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('/tools/qr-generator')}
            className="min-h-[44px] px-6 rounded-2xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-sm font-bold cursor-pointer"
          >
            Create Your Own QR
          </button>
        </div>
      </div>
    );
  }

  if (status !== 'ok' || !record) {
    return (
      <div className="max-w-lg mx-auto px-4 sm:px-6 py-16 text-center">
        <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-8 space-y-4">
          <span className="w-14 h-14 rounded-2xl bg-[#C9A227]/12 text-[#B88E1E] dark:text-[#D4AF37] flex items-center justify-center mx-auto">
            <AlertCircle className="w-7 h-7" />
          </span>
          <h1 className="text-xl font-extrabold text-[#111214] dark:text-[#F4F4F0]">
            QR content not found
          </h1>
          <p className="text-sm text-[#5A5D65] dark:text-[#9CA0AA]">
            This link may be invalid or removed by its creator.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="min-h-[44px] px-6 rounded-2xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-sm font-bold cursor-pointer"
          >
            Go to RIKZEN Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12 pb-24 space-y-6">
      {/* Branded Card */}
      <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-5 sm:p-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EFECE4] dark:border-[#1E222C] pb-4">
          <RikzenLogo size="sm" />
          <div className="flex items-center gap-2 text-xs text-[#6B707B] dark:text-[#9CA0AA]">
            <span className="px-2.5 py-1 rounded-lg bg-[#C9A227]/15 text-[#9A7410] dark:text-[#D4AF37] font-bold uppercase">
              {record.qrType}
            </span>
            {record.expiresAt && (
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                Expires {new Date(record.expiresAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-1">
          <h1 className="text-2xl font-extrabold text-[#111214] dark:text-[#F4F4F0] break-words">
            {record.name}
          </h1>
          {(record.fileName || record.sizeBytes > 0) && (
            <p className="text-xs text-[#6B707B] dark:text-[#9CA0AA] font-mono tabular-nums">
              {record.fileName ? `${record.fileName} · ` : ''}
              {record.sizeBytes > 0 ? formatBytes(record.sizeBytes) : ''}
              {record.durationSec ? ` · ${formatDuration(record.durationSec)}` : ''}
              {record.width && record.height ? ` · ${record.width}×${record.height}` : ''}
            </p>
          )}
        </div>

        {/* IMAGE QR CONTENT */}
        {record.qrType === 'image' && record.mediaUrl && (
          <div className="space-y-4">
            <div
              onClick={() => setZoomImage(true)}
              className="rounded-2xl border border-[#E2DED4] dark:border-[#262B37] bg-[#FAF8F4] dark:bg-[#0D1015] p-3 flex justify-center cursor-zoom-in overflow-hidden"
            >
              <img
                src={record.mediaUrl}
                alt={record.name}
                className="max-h-[460px] w-auto object-contain rounded-xl"
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={downloading}
                onClick={() => void handleDownloadMedia()}
                className="flex-1 min-w-[160px] min-h-[48px] px-5 rounded-2xl bg-gradient-to-b from-[#1A1C22] to-[#0B0D11] dark:from-[#E5C453] dark:to-[#C59D24] text-white dark:text-[#0B0C0E] text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>{downloading ? 'Downloading...' : 'Download Image'}</span>
              </button>
              <button
                type="button"
                onClick={() => void handleSharePage()}
                className="min-h-[48px] px-5 rounded-2xl border border-[#DAD4C7] dark:border-[#2B303C] text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
              >
                <Share2 className="w-4 h-4" />
                <span>Share</span>
              </button>
            </div>
          </div>
        )}

        {/* VIDEO QR CONTENT */}
        {record.qrType === 'video' && record.mediaUrl && (
          <div className="space-y-4">
            <div className="rounded-2xl overflow-hidden bg-black border border-[#E2DED4] dark:border-[#262B37]">
              <video
                src={record.mediaUrl}
                poster={record.thumbnailUrl || undefined}
                controls
                playsInline
                preload="metadata"
                className="w-full max-h-[460px] mx-auto"
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={downloading}
                onClick={() => void handleDownloadMedia()}
                className="flex-1 min-w-[160px] min-h-[48px] px-5 rounded-2xl bg-gradient-to-b from-[#1A1C22] to-[#0B0D11] dark:from-[#E5C453] dark:to-[#C59D24] text-white dark:text-[#0B0C0E] text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>{downloading ? 'Downloading...' : 'Download Video'}</span>
              </button>
              <button
                type="button"
                onClick={() => void handleSharePage()}
                className="min-h-[48px] px-5 rounded-2xl border border-[#DAD4C7] dark:border-[#2B303C] text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
              >
                <Share2 className="w-4 h-4" />
                <span>Share</span>
              </button>
            </div>
          </div>
        )}

        {/* FILE QR CONTENT */}
        {record.qrType === 'file' && record.downloadUrl && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-[#E2DED4] dark:border-[#262B37] bg-[#FAF8F4] dark:bg-[#0D1015] p-5 flex items-center gap-4">
              <span className="w-14 h-14 rounded-2xl bg-[#C9A227]/15 text-[#B88E1E] dark:text-[#D4AF37] flex items-center justify-center shrink-0">
                <FileText className="w-7 h-7" />
              </span>
              <div className="min-w-0">
                <p className="text-base font-bold text-[#111214] dark:text-[#F4F4F0] truncate">
                  {record.fileName || record.name}
                </p>
                <p className="text-xs text-[#6B707B] dark:text-[#9CA0AA] mt-0.5">
                  {record.mimeType || 'Document'} · {formatBytes(record.sizeBytes)}
                </p>
              </div>
            </div>

            {record.mimeType === 'application/pdf' && record.mediaUrl && (
              <iframe
                src={record.mediaUrl}
                title={record.name}
                className="w-full h-96 rounded-2xl border border-[#E2DED4] dark:border-[#262B37] bg-white"
              />
            )}

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={downloading}
                onClick={() => void handleDownloadMedia()}
                className="flex-1 min-w-[160px] min-h-[48px] px-5 rounded-2xl bg-gradient-to-b from-[#1A1C22] to-[#0B0D11] dark:from-[#E5C453] dark:to-[#C59D24] text-white dark:text-[#0B0C0E] text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>{downloading ? 'Downloading...' : 'Download File'}</span>
              </button>
              <button
                type="button"
                onClick={() => void handleSharePage()}
                className="min-h-[48px] px-5 rounded-2xl border border-[#DAD4C7] dark:border-[#2B303C] text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
              >
                <Share2 className="w-4 h-4" />
                <span>Share</span>
              </button>
            </div>
          </div>
        )}

        {/* STRUCTURED / TEXT / LINK QR CONTENT */}
        {!['image', 'video', 'file'].includes(record.qrType) && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-[#E2DED4] dark:border-[#262B37] bg-[#FAF8F4] dark:bg-[#0D1015] p-5 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-[#B88E1E] dark:text-[#D4AF37]">
                {record.qrType === 'wifi' && <Wifi className="w-4 h-4" />}
                {record.qrType === 'email' && <Mail className="w-4 h-4" />}
                {record.qrType === 'phone' && <Phone className="w-4 h-4" />}
                {record.qrType === 'location' && <MapPin className="w-4 h-4" />}
                {record.qrType === 'image' && <ImageIcon className="w-4 h-4" />}
                {record.qrType === 'video' && <Film className="w-4 h-4" />}
                <span>Shared {record.qrType.toUpperCase()} Content</span>
              </div>
              <pre className="text-sm font-mono whitespace-pre-wrap break-all text-[#111214] dark:text-[#F4F4F0]">
                {record.payload}
              </pre>
            </div>

            <div className="flex flex-wrap gap-2.5">
              {record.qrType === 'link' && isSafeHttpUrl(record.payload) && (
                <a
                  href={record.payload}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[46px] px-5 rounded-2xl bg-gradient-to-b from-[#1A1C22] to-[#0B0D11] dark:from-[#E5C453] dark:to-[#C59D24] text-white dark:text-[#0B0C0E] text-sm font-bold inline-flex items-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Open Website</span>
                </a>
              )}

              {record.qrType === 'contact' && (
                <button
                  type="button"
                  onClick={() => {
                    const blob = new Blob([record.payload], { type: 'text/vcard;charset=utf-8' });
                    triggerBlobSave(blob, `${record.name.replace(/\s+/g, '-')}.vcf`);
                  }}
                  className="min-h-[46px] px-5 rounded-2xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-sm font-bold inline-flex items-center gap-2 cursor-pointer"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Save Contact (.vcf)</span>
                </button>
              )}

              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard?.writeText(record.payload);
                  notify('Content copied.', 'success');
                }}
                className="min-h-[46px] px-5 rounded-2xl border border-[#DAD4C7] dark:border-[#2B303C] text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
              >
                <Copy className="w-4 h-4" />
                <span>Copy Content</span>
              </button>
            </div>
          </div>
        )}

        <div className="pt-3 border-t border-[#EFECE4] dark:border-[#1E222C] flex flex-wrap items-center justify-between gap-2 text-xs text-[#6B707B] dark:text-[#9CA0AA]">
          <span className="inline-flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-[#C9A227]" />
            Hosted safely via RIKZEN QR
          </span>
          <button
            type="button"
            onClick={() => onNavigate('/tools/qr-generator')}
            className="font-semibold text-[#B88E1E] dark:text-[#D4AF37] hover:underline cursor-pointer"
          >
            Create a QR Code →
          </button>
        </div>
      </div>

      {/* Image Lightbox */}
      {zoomImage && record.mediaUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setZoomImage(false)}
        >
          <button
            type="button"
            onClick={() => setZoomImage(false)}
            aria-label="Close preview"
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/15 text-white flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={record.mediaUrl}
            alt={record.name}
            className="max-w-full max-h-[90vh] object-contain rounded-xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};
