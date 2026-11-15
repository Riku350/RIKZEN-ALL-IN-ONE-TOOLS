import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Copy,
  Download,
  Edit3,
  ExternalLink,
  FileText,
  Film,
  Image as ImageIcon,
  Link2,
  Loader2,
  Plus,
  QrCode,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { GoogleAuthCard } from '../components/GoogleAuthCard';
import { formatBytes, formatRelativeDate } from '../lib/formatters';
import { triggerBlobSave } from '../lib/downloadClient';
import {
  DEFAULT_QR_DESIGN,
  QrContentType,
  QrDesignConfig,
  QrExpirationPreset,
  renderQrPngBlob,
  renderStyledQr,
} from '../lib/qrRenderer';

interface MyQrItem {
  shareId: string;
  name: string;
  qrType: QrContentType;
  payload: string;
  shareUrl: string;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number;
  thumbnailUrl: string | null;
  design: QrDesignConfig | null;
  expirationPreset: QrExpirationPreset;
  expiresAt: number | null;
  createdAt: number;
}

const FILTER_TABS = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Image QR' },
  { id: 'video', label: 'Video QR' },
  { id: 'file', label: 'File QR' },
  { id: 'link', label: 'Link QR' },
  { id: 'text', label: 'Text QR' },
  { id: 'other', label: 'More' },
] as const;

const MiniQrThumb: React.FC<{ payload: string; design: QrDesignConfig | null }> = ({
  payload,
  design,
}) => {
  const dataUrl = useMemo(() => {
    try {
      return renderStyledQr(payload, design || DEFAULT_QR_DESIGN, 220).dataUrl;
    } catch {
      return '';
    }
  }, [payload, design]);

  return dataUrl ? (
    <img
      src={dataUrl}
      alt="QR Thumbnail"
      className="w-16 h-16 rounded-xl border border-[#E2DED4] dark:border-[#262B37] bg-white object-contain shrink-0"
    />
  ) : (
    <div className="w-16 h-16 rounded-xl bg-[#FAF8F4] dark:bg-[#0D1015] flex items-center justify-center shrink-0">
      <QrCode className="w-7 h-7 text-[#C9A227]" />
    </div>
  );
};

export const MyQrCodesPage: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const { user, loading: authLoading, getToken } = useAuth();
  const { notify } = useApp();

  const [records, setRecords] = useState<MyQrItem[]>([]);
  const [storage, setStorage] = useState<{ usedBytes: number; limitBytes: number }>({
    usedBytes: 0,
    limitBytes: 500 * 1024 * 1024,
  });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<(typeof FILTER_TABS)[number]['id']>('all');

  // Edit modal
  const [editing, setEditing] = useState<MyQrItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editPayload, setEditPayload] = useState('');
  const [editExp, setEditExp] = useState<QrExpirationPreset>('never');
  const [savingEdit, setSavingEdit] = useState(false);

  const loadMyQrs = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch('/api/qr/my', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setRecords(Array.isArray(json.records) ? json.records : []);
        if (json.storage) setStorage(json.storage);
      }
    } catch {
      notify('Could not load saved QR codes.', 'error');
    } finally {
      setLoading(false);
    }
  }, [user, getToken, notify]);

  useEffect(() => {
    void loadMyQrs();
  }, [loadMyQrs]);

  const filtered = useMemo(() => {
    if (activeTab === 'all') return records;
    if (activeTab === 'other') {
      return records.filter((r) => !['image', 'video', 'file', 'link', 'text'].includes(r.qrType));
    }
    return records.filter((r) => r.qrType === activeTab);
  }, [records, activeTab]);

  const handleDownloadQr = async (item: MyQrItem) => {
    try {
      const d = item.design || DEFAULT_QR_DESIGN;
      const { blob } = await renderQrPngBlob(item.payload, d, 1024);
      const slug = item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'rikzen-qr';
      triggerBlobSave(blob, `${slug}.png`);
      notify('QR PNG downloaded.', 'success');
    } catch {
      notify('Could not export QR image.', 'error');
    }
  };

  const handleDelete = async (shareId: string) => {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`/api/qr/${encodeURIComponent(shareId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Delete failed.');
      setRecords((prev) => prev.filter((r) => r.shareId !== shareId));
      notify('QR code deleted.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not delete QR code.', 'error');
    }
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setSavingEdit(true);
    try {
      const token = await getToken();
      if (!token) return;
      const body: Record<string, unknown> = {
        name: editName.trim() || editing.name,
        expiration: editExp,
      };
      if (!['image', 'video', 'file'].includes(editing.qrType) && editPayload.trim()) {
        body.payload = editPayload.trim();
      }
      const res = await fetch(`/api/qr/${encodeURIComponent(editing.shareId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.record) throw new Error(json.error || 'Could not update QR code.');
      setRecords((prev) => prev.map((r) => (r.shareId === editing.shareId ? json.record : r)));
      setEditing(null);
      notify('QR code updated.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Update failed.', 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  if (authLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 space-y-4">
        <div className="h-24 rounded-3xl bg-[#EAE6DC] dark:bg-[#1B1E26] animate-pulse" />
        <div className="h-64 rounded-3xl bg-[#EAE6DC] dark:bg-[#1B1E26] animate-pulse" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 pb-24 space-y-5">
        <div className="text-center space-y-1.5">
          <h1 className="text-2xl font-extrabold text-[#111214] dark:text-[#F4F4F0]">
            My QR Codes
          </h1>
          <p className="text-sm text-[#5A5D65] dark:text-[#9CA0AA]">
            Sign in with Google to save, edit, and manage all your Image, Video, File, and Link QR codes.
          </p>
        </div>
        <GoogleAuthCard onSuccess={() => void loadMyQrs()} />
      </div>
    );
  }

  const pctUsed = Math.min(
    100,
    Math.round((storage.usedBytes / Math.max(1, storage.limitBytes)) * 100)
  );

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-6 pb-24 md:pb-16">
      {/* Header + Create Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#111214] dark:text-[#F4F4F0]">
            My QR Codes
          </h1>
          <p className="text-sm text-[#5A5D65] dark:text-[#9CA0AA] mt-0.5">
            {records.length} saved QR {records.length === 1 ? 'item' : 'items'} ·{' '}
            <span className="font-mono tabular-nums">
              {formatBytes(storage.usedBytes)} / {formatBytes(storage.limitBytes)}
            </span>{' '}
            used ({pctUsed}%)
          </p>
        </div>

        <button
          type="button"
          onClick={() => onNavigate('/tools/qr-generator')}
          className="min-h-[44px] px-5 rounded-2xl bg-gradient-to-b from-[#1A1C22] to-[#0B0D11] dark:from-[#E5C453] dark:to-[#C59D24] text-white dark:text-[#0B0C0E] text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span>Create New QR</span>
        </button>
      </div>

      {/* Category Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`min-h-[38px] px-4 rounded-xl text-xs font-bold whitespace-nowrap transition-colors cursor-pointer border ${
              activeTab === tab.id
                ? 'border-[#C9A227] bg-[#C9A227]/15 text-[#9A7410] dark:text-[#D4AF37]'
                : 'border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] text-[#5A5D65] dark:text-[#9CA0AA]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* QR List */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((k) => (
            <div
              key={k}
              className="h-32 rounded-3xl bg-[#EAE6DC] dark:bg-[#1B1E26] animate-pulse"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-10 text-center space-y-4">
          <span className="w-14 h-14 rounded-2xl bg-[#C9A227]/12 text-[#B88E1E] dark:text-[#D4AF37] flex items-center justify-center mx-auto">
            <QrCode className="w-7 h-7" />
          </span>
          <div>
            <h2 className="text-lg font-bold text-[#111214] dark:text-[#F4F4F0]">
              No QR codes in this view yet
            </h2>
            <p className="text-sm text-[#5A5D65] dark:text-[#9CA0AA] mt-1">
              Create your first Link, Image, Video, File, or Wi-Fi QR code in seconds.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/tools/qr-generator')}
            className="min-h-[44px] px-6 rounded-2xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-sm font-bold cursor-pointer"
          >
            Create QR Code
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((item) => {
            const typeIcon =
              item.qrType === 'image' ? (
                <ImageIcon className="w-3.5 h-3.5" />
              ) : item.qrType === 'video' ? (
                <Film className="w-3.5 h-3.5" />
              ) : item.qrType === 'file' ? (
                <FileText className="w-3.5 h-3.5" />
              ) : item.qrType === 'link' ? (
                <Link2 className="w-3.5 h-3.5" />
              ) : (
                <Type className="w-3.5 h-3.5" />
              );

            return (
              <div
                key={item.shareId}
                className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-5 flex flex-col justify-between gap-4"
              >
                <div className="flex items-start gap-4">
                  <MiniQrThumb payload={item.payload} design={item.design} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[11px] font-bold uppercase text-[#B88E1E] dark:text-[#D4AF37]">
                      {typeIcon}
                      <span>{item.qrType} QR</span>
                      <span className="text-[#8E939E] font-normal">·</span>
                      <span className="text-[#6B707B] dark:text-[#9CA0AA] font-normal normal-case">
                        {formatRelativeDate(new Date(item.createdAt))}
                      </span>
                    </div>
                    <h2 className="text-base font-bold text-[#111214] dark:text-[#F4F4F0] truncate mt-0.5">
                      {item.name}
                    </h2>
                    <p className="text-xs font-mono text-[#6B707B] dark:text-[#9CA0AA] truncate mt-0.5">
                      {['image', 'video', 'file'].includes(item.qrType)
                        ? item.shareUrl
                        : item.payload}
                    </p>
                    <p className="text-[11px] text-[#8E939E] mt-1">
                      {item.expiresAt
                        ? `Expires ${new Date(item.expiresAt).toLocaleDateString()}`
                        : 'Permanent · No expiration'}
                      {item.sizeBytes > 0 && ['image', 'video', 'file'].includes(item.qrType)
                        ? ` · ${formatBytes(item.sizeBytes)}`
                        : ''}
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t border-[#EFECE4] dark:border-[#1E222C] flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onNavigate(`/q/${item.shareId}`)}
                    className="min-h-[36px] px-3 rounded-xl bg-[#FAF8F4] dark:bg-[#0D1015] border border-[#E2DED4] dark:border-[#262B37] text-xs font-semibold inline-flex items-center gap-1.5 hover:border-[#C9A227] cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open</span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const val = ['image', 'video', 'file'].includes(item.qrType)
                        ? item.shareUrl
                        : item.payload;
                      await navigator.clipboard?.writeText(val);
                      notify('Copied link.', 'success');
                    }}
                    className="min-h-[36px] px-3 rounded-xl bg-[#FAF8F4] dark:bg-[#0D1015] border border-[#E2DED4] dark:border-[#262B37] text-xs font-semibold inline-flex items-center gap-1.5 hover:border-[#C9A227] cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownloadQr(item)}
                    className="min-h-[36px] px-3 rounded-xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(item);
                      setEditName(item.name);
                      setEditPayload(item.payload);
                      setEditExp(item.expirationPreset || 'never');
                    }}
                    className="min-h-[36px] px-3 rounded-xl border border-[#DAD4C7] dark:border-[#2B303C] text-xs font-semibold inline-flex items-center gap-1 hover:border-[#C9A227] cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(item.shareId)}
                    aria-label="Delete QR"
                    className="min-h-[36px] px-3 rounded-xl border border-[#DAD4C7] dark:border-[#2B303C] text-xs font-semibold text-red-600 dark:text-red-400 inline-flex items-center gap-1 hover:border-red-400 cursor-pointer ml-auto"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit Modal */}
      {editing && (
        <div
          className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setEditing(null)}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-[#E2DED4] dark:border-[#262B37] bg-white dark:bg-[#12151B] p-6 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-[#111214] dark:text-[#F4F4F0]">
                Edit QR Code
              </h3>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="min-h-[34px] min-w-[34px] rounded-xl flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <label className="block space-y-1">
              <span className="text-xs font-semibold">QR Name</span>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={140}
                className="w-full min-h-[44px] rounded-xl border border-[#DAD4C7] dark:border-[#2B303C] bg-[#FAF8F4] dark:bg-[#0D1015] px-3.5 text-sm"
              />
            </label>

            {!['image', 'video', 'file'].includes(editing.qrType) && (
              <label className="block space-y-1">
                <span className="text-xs font-semibold">Destination / Content</span>
                <textarea
                  rows={3}
                  value={editPayload}
                  onChange={(e) => setEditPayload(e.target.value)}
                  className="w-full rounded-xl border border-[#DAD4C7] dark:border-[#2B303C] bg-[#FAF8F4] dark:bg-[#0D1015] p-3 text-sm font-mono"
                />
              </label>
            )}

            <label className="block space-y-1">
              <span className="text-xs font-semibold">Expiration</span>
              <select
                value={editExp}
                onChange={(e) => setEditExp(e.target.value as QrExpirationPreset)}
                className="w-full min-h-[44px] rounded-xl border border-[#DAD4C7] dark:border-[#2B303C] bg-[#FAF8F4] dark:bg-[#0D1015] px-3.5 text-sm"
              >
                <option value="never">Never (Permanent)</option>
                <option value="1d">1 Day from now</option>
                <option value="7d">7 Days from now</option>
                <option value="30d">30 Days from now</option>
              </select>
            </label>

            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="flex-1 min-h-[44px] rounded-xl border border-[#DAD4C7] dark:border-[#2B303C] text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingEdit}
                onClick={() => void handleSaveEdit()}
                className="flex-1 min-h-[44px] rounded-xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {savingEdit && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Save Changes</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
