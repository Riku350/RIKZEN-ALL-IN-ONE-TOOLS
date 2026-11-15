import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Layers,
  Link2,
  Loader2,
  Mail,
  MapPin,
  Palette,
  Phone,
  Printer,
  QrCode,
  RefreshCw,
  ScanLine,
  Share2,
  Sparkles,
  Trash2,
  Type,
  Upload,
  UserSquare2,
  Wifi,
  X,
} from 'lucide-react';
import { ToolDefinition } from '../../lib/toolRegistry';
import { useApp } from '../../contexts/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { downloadFileSafely, triggerBlobSave } from '../../lib/downloadClient';
import { formatBytes, logClientToolExecution, trackAnalyticsEvent } from '../../lib/formatters';
import { ImageUrlLoader, LoadedUrlImage, LoadedUrlMeta } from '../ImageUrlLoader';
import { SelectedUploadItem, UploadZone } from '../UploadZone';
import { BatchJobItem, BatchStatusTable } from './BatchStatusTable';
import {
  DEFAULT_QR_DESIGN,
  QR_TEMPLATES,
  QrContentType,
  QrDesignConfig,
  QrExpirationPreset,
  buildQrPayloadFromForm,
  captureVideoMetadataClient,
  renderQrPngBlob,
  renderStyledQr,
  syncQrToFirestore,
} from '../../lib/qrRenderer';

interface BatchQrQueueEntry extends BatchJobItem {
  kind: 'url' | 'file';
  url?: string;
  file?: File;
  pngBlob?: Blob;
  shareUrl?: string;
}

interface CreatedQrResult {
  shareId: string;
  name: string;
  qrType: QrContentType;
  payload: string;
  shareUrl: string;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number;
  durationSec?: number | null;
  thumbnailUrl?: string | null;
  mediaUrl?: string | null;
  downloadUrl?: string | null;
  expiresAt: number | null;
  createdAt: number;
  design: QrDesignConfig;
}

const LOCAL_HISTORY_KEY = 'rikzen-qr-local-history';

const QR_TYPE_OPTIONS: {
  id: QrContentType;
  label: string;
  hint: string;
  icon: React.FC<{ className?: string }>;
}[] = [
  { id: 'link', label: 'Link', hint: 'Website URL', icon: Link2 },
  { id: 'text', label: 'Text', hint: 'Note or message', icon: Type },
  { id: 'contact', label: 'Contact', hint: 'vCard profile', icon: UserSquare2 },
  { id: 'wifi', label: 'Wi-Fi', hint: 'One-tap join', icon: Wifi },
  { id: 'email', label: 'Email', hint: 'Pre-filled mail', icon: Mail },
  { id: 'phone', label: 'Phone', hint: 'Direct call', icon: Phone },
  { id: 'location', label: 'Location', hint: 'Map GPS pin', icon: MapPin },
  { id: 'image', label: 'Image', hint: 'JPG, PNG, WebP, GIF', icon: ImageIcon },
  { id: 'video', label: 'Video', hint: 'MP4, MOV, WebM', icon: Film },
  { id: 'file', label: 'File', hint: 'PDF, DOC, ZIP', icon: FileText },
];

const EXPIRATION_OPTIONS: { id: QrExpirationPreset; label: string }[] = [
  { id: 'never', label: 'Never' },
  { id: '1d', label: '1 Day' },
  { id: '7d', label: '7 Days' },
  { id: '30d', label: '30 Days' },
  { id: 'custom', label: 'Custom' },
];

function formatDuration(sec?: number | null): string {
  if (!sec || !Number.isFinite(sec)) return '';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const QrStudioWorkspace: React.FC<{
  tool: ToolDefinition;
  onNavigate?: (path: string) => void;
}> = ({ tool, onNavigate }) => {
  const { user, getToken } = useAuth();
  const { capabilities, notify } = useApp();

  const [qrType, setQrType] = useState<QrContentType>('link');
  const [qrName, setQrName] = useState('');
  const [expiration, setExpiration] = useState<QrExpirationPreset>('never');
  const [customDate, setCustomDate] = useState(() => {
    const d = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  });

  // Form states per QR content type
  const [urlVal, setUrlVal] = useState('https://');
  const [textVal, setTextVal] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactOrg, setContactOrg] = useState('');
  const [contactUrl, setContactUrl] = useState('');
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [showWifiPass, setShowWifiPass] = useState(false);
  const [wifiSecurity, setWifiSecurity] = useState<'WPA' | 'WEP' | 'nopass'>('WPA');
  const [wifiHidden, setWifiHidden] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [locLoading, setLocLoading] = useState(false);

  // Media / File states (Image, Video, File)
  const [imageInputMode, setImageInputMode] = useState<'upload' | 'url'>('upload');
  const [directImageUrlMeta, setDirectImageUrlMeta] = useState<LoadedUrlMeta | null>(null);
  const [directImagePreviewUrl, setDirectImagePreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [videoMeta, setVideoMeta] = useState<{
    durationSec: number | null;
    width: number | null;
    height: number | null;
    thumbnailBlob: Blob | null;
    thumbnailDataUrl: string | null;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Single vs Batch QR mode
  const [studioMode, setStudioMode] = useState<'single' | 'batch'>('single');
  const [batchQrKind, setBatchQrKind] = useState<'urls' | 'files'>('urls');
  const [batchUrlsText, setBatchUrlsText] = useState('');
  const [batchFiles, setBatchFiles] = useState<SelectedUploadItem[]>([]);
  const [batchQueue, setBatchQueue] = useState<BatchQrQueueEntry[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchZipBusy, setBatchZipBusy] = useState(false);

  // Creation / Upload progress state
  const [phase, setPhase] = useState<'form' | 'result'>('form');
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [statusLabel, setStatusLabel] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Result & Customization state
  const [result, setResult] = useState<CreatedQrResult | null>(null);
  const [design, setDesign] = useState<QrDesignConfig>(DEFAULT_QR_DESIGN);
  const [showCustomize, setShowCustomize] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [pdfDownloading, setPdfDownloading] = useState(false);

  const maxBatchFiles = capabilities.maxFilesPerBatch || 50;

  // Local recent QR history strip
  const [localHistory, setLocalHistory] = useState<CreatedQrResult[]>(() => {
    try {
      const raw = localStorage.getItem(LOCAL_HISTORY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as CreatedQrResult[];
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch {
      // ignore storage error
    }
    return [];
  });

  const saveLocalHistory = useCallback((items: CreatedQrResult[]) => {
    setLocalHistory(items);
    try {
      localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(items.slice(0, 20)));
    } catch {
      // ignore quota
    }
  }, []);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
      if (directImagePreviewUrl) URL.revokeObjectURL(directImagePreviewUrl);
    };
  }, [imagePreviewUrl, directImagePreviewUrl]);

  const handleSelectType = (nextType: QrContentType) => {
    setQrType(nextType);
    setFormError(null);
    setSelectedFile(null);
    setImageInputMode('upload');
    setDirectImageUrlMeta(null);
    if (directImagePreviewUrl) {
      URL.revokeObjectURL(directImagePreviewUrl);
      setDirectImagePreviewUrl(null);
    }
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
      setImagePreviewUrl(null);
    }
    setVideoMeta(null);
    if (nextType === 'image' && design.template === 'classic') {
      setDesign((d) => ({ ...d, template: 'photo', moduleStyle: 'rounded', eyeStyle: 'rounded', logoMode: 'photo' }));
    } else if (nextType === 'video' && design.template === 'classic') {
      setDesign((d) => ({ ...d, template: 'video', moduleStyle: 'rounded', eyeStyle: 'rounded', logoMode: 'video' }));
    } else if (!['image', 'video'].includes(nextType) && (design.template === 'photo' || design.template === 'video')) {
      setDesign(DEFAULT_QR_DESIGN);
    }
  };

  const handlePickMediaFile = async (file: File) => {
    setFormError(null);
    const maxMb =
      qrType === 'image'
        ? capabilities.maxQrImageMb
        : qrType === 'video'
        ? capabilities.maxQrVideoMb
        : capabilities.maxQrFileMb;

    if (file.size > maxMb * 1024 * 1024) {
      setFormError(
        `${file.name} is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Max limit for ${qrType} QR is ${maxMb} MB.`
      );
      return;
    }

    setSelectedFile(file);
    if (!qrName.trim()) {
      setQrName(file.name.replace(/\.[^.]+$/, '').slice(0, 80));
    }

    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
      setImagePreviewUrl(null);
    }
    setVideoMeta(null);

    if (qrType === 'image') {
      setImagePreviewUrl(URL.createObjectURL(file));
    } else if (qrType === 'video') {
      const meta = await captureVideoMetadataClient(file);
      setVideoMeta(meta);
    }
  };

  const detectLocation = () => {
    if (!navigator.geolocation) {
      setFormError('Geolocation is not supported in this browser.');
      return;
    }
    setLocLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setLocLoading(false);
      },
      () => {
        setFormError('Location access denied. Enter latitude and longitude manually.');
        setLocLoading(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const renderedQr = useMemo(() => {
    if (!result) return null;
    try {
      return renderStyledQr(result.payload, design, 512);
    } catch {
      return null;
    }
  }, [result, design]);

  const handleLoadedQrImageUrl = (loaded: LoadedUrlImage) => {
    setFormError(null);
    if (directImagePreviewUrl) URL.revokeObjectURL(directImagePreviewUrl);
    setDirectImagePreviewUrl(loaded.previewUrl);
    setDirectImageUrlMeta({
      originalUrl: loaded.originalUrl,
      finalUrl: loaded.finalUrl,
      previewUrl: loaded.previewUrl,
      fileName: loaded.fileName,
      mimeType: loaded.mimeType,
      format: loaded.format,
      width: loaded.width,
      height: loaded.height,
      sizeBytes: loaded.sizeBytes,
    });
    if (!qrName.trim()) {
      setQrName(loaded.fileName.replace(/\.[^.]+$/, '').slice(0, 80));
    }
  };

  const handleCreateBatchQrs = async () => {
    setFormError(null);
    let initialItems: BatchQrQueueEntry[] = [];

    if (batchQrKind === 'urls') {
      const lines = batchUrlsText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      if (lines.length === 0) {
        setFormError('Paste at least 1 URL (one link per line).');
        return;
      }
      if (lines.length > maxBatchFiles) {
        setFormError(`Maximum ${maxBatchFiles} URLs allowed per batch.`);
        return;
      }

      initialItems = lines.map((line, idx) => {
        const normalized = /^https?:\/\//i.test(line) ? line : `https://${line}`;
        let isValid = false;
        try {
          const parsed = new URL(normalized);
          isValid = parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          isValid = false;
        }
        return {
          id: `url-${idx}-${Date.now()}`,
          kind: 'url',
          url: normalized,
          fileName: line.replace(/^https?:\/\//i, '').slice(0, 60) || `Link ${idx + 1}`,
          sizeBytes: normalized.length,
          status: isValid ? 'queued' : 'error',
          errorText: isValid ? undefined : 'Invalid URL',
          detailsText: isValid ? 'Direct URL' : undefined,
        };
      });
    } else {
      if (batchFiles.length === 0) {
        setFormError('Choose files or images first.');
        return;
      }
      initialItems = batchFiles.map((item, idx) => ({
        id: `file-${idx}-${Date.now()}`,
        kind: 'file',
        file: item.file,
        fileName: item.file.name,
        sizeBytes: item.file.size,
        thumbnailUrl: item.previewUrl,
        status: 'queued',
      }));
    }

    setBatchQueue(initialItems);
    setBatchBusy(true);
    void trackAnalyticsEvent('processing_started', tool.id, tool.category);

    try {
      const token = await getToken();
      const targets = initialItems.filter((i) => i.status === 'queued');
      const concurrency = Math.min(4, capabilities.maxConcurrentJobs || 4);
      let cursor = 0;

      const worker = async () => {
        while (cursor < targets.length) {
          const entry = targets[cursor++];
          setBatchQueue((prev) =>
            prev.map((q) => (q.id === entry.id ? { ...q, status: 'processing' } : q))
          );
          try {
            let rec: CreatedQrResult;
            if (entry.kind === 'url' && entry.url) {
              const res = await fetch('/api/qr/create', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({
                  qrType: 'link',
                  name: entry.fileName,
                  payload: entry.url,
                  expiration: 'never',
                  design,
                }),
              });
              const json = await res.json();
              if (!res.ok || !json.record) {
                throw new Error(json.error || 'Failed to create QR.');
              }
              rec = { ...json.record, design };
            } else if (entry.file) {
              const mediaType: 'image' | 'file' = entry.file.type.startsWith('image/')
                ? 'image'
                : 'file';
              const formData = new FormData();
              formData.append('qrType', mediaType);
              formData.append('name', entry.file.name.replace(/\.[^.]+$/, ''));
              formData.append('expiration', 'never');
              formData.append('design', JSON.stringify(design));
              formData.append('file', entry.file);

              const res = await fetch('/api/qr/upload', {
                method: 'POST',
                headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                body: formData,
              });
              const json = await res.json();
              if (!res.ok || !json.record) {
                throw new Error(json.error || 'Upload failed.');
              }
              rec = { ...json.record, design };
            } else {
              throw new Error('Missing QR input.');
            }

            const { blob } = await renderQrPngBlob(rec.payload, design, design.resolution);
            const blobUrl = URL.createObjectURL(blob);
            const safeSlug =
              entry.fileName
                .replace(/\.[^.]+$/, '')
                .replace(/[^a-z0-9_-]+/gi, '-')
                .slice(0, 40) || 'rikzen-qr';

            setBatchQueue((prev) =>
              prev.map((q) =>
                q.id === entry.id
                  ? {
                      ...q,
                      status: 'done',
                      pngBlob: blob,
                      downloadUrl: blobUrl,
                      downloadFileName: `${safeSlug}-qr.png`,
                      outputSizeBytes: blob.size,
                      shareUrl: rec.shareUrl,
                      detailsText: entry.kind === 'url' ? 'Direct QR PNG' : 'Hosted QR PNG',
                    }
                  : q
              )
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed';
            setBatchQueue((prev) =>
              prev.map((q) =>
                q.id === entry.id ? { ...q, status: 'error', errorText: msg } : q
              )
            );
          }
        }
      };

      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      notify('Batch QR codes generated!', 'success');
    } finally {
      setBatchBusy(false);
    }
  };

  const handleDownloadAllBatchQrs = async () => {
    const done = batchQueue.filter((q) => q.status === 'done' && q.pngBlob);
    if (done.length === 0) return;

    setBatchZipBusy(true);
    try {
      const zip = new JSZip();
      const used = new Set<string>();
      for (const item of done) {
        if (!item.pngBlob) continue;
        const baseName = item.downloadFileName || 'rikzen-qr.png';
        let finalName = baseName;
        let idx = 2;
        while (used.has(finalName)) {
          finalName = baseName.replace(/\.png$/i, `-${idx}.png`);
          idx++;
        }
        used.add(finalName);
        zip.file(finalName, item.pngBlob);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      triggerBlobSave(zipBlob, `rikzen-qr-batch-${done.length}.zip`);
      void trackAnalyticsEvent('download_clicked', tool.id, tool.category);
    } finally {
      setBatchZipBusy(false);
    }
  };

  const handleCreateQr = async () => {
    setFormError(null);
    const customExpiresAt =
      expiration === 'custom' && customDate ? new Date(`${customDate}T23:59:59`).toISOString() : undefined;

    // IMAGE -> IMAGE URL DIRECT MODE (encode exact external image URL directly without re-uploading!)
    if (qrType === 'image' && imageInputMode === 'url') {
      if (!directImageUrlMeta?.originalUrl) {
        setFormError('Paste an image URL and click Load Image first.');
        return;
      }

      setBusy(true);
      setStatusLabel('Creating QR...');
      try {
        const token = await getToken();
        const finalName =
          qrName.trim() || directImageUrlMeta.fileName.replace(/\.[^.]+$/, '') || 'Image Link QR';
        const res = await fetch('/api/qr/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            qrType: 'link',
            name: finalName,
            payload: directImageUrlMeta.originalUrl,
            expiration,
            customExpiresAt,
            design,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.record) {
          throw new Error(json.error || 'Could not create QR code.');
        }

        const rec: CreatedQrResult = {
          ...json.record,
          design,
        };
        setResult(rec);
        setPhase('result');
        saveLocalHistory([rec, ...localHistory.filter((i) => i.shareId !== rec.shareId)]);

        if (user) {
          void syncQrToFirestore({
            userId: user.uid,
            shareId: rec.shareId,
            name: rec.name,
            qrType: rec.qrType,
            payload: rec.payload,
            shareUrl: rec.shareUrl,
            sizeBytes: rec.sizeBytes,
            design,
            expiresAt: rec.expiresAt,
          });
        }

        void logClientToolExecution({
          toolId: tool.id,
          toolName: tool.name,
          category: tool.category,
          fileName: finalName,
        });
        notify('Direct Image URL QR created!', 'success');
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'Could not create QR.');
      } finally {
        setBusy(false);
        setStatusLabel('');
      }
      return;
    }

    if (['image', 'video', 'file'].includes(qrType)) {
      if (!selectedFile) {
        setFormError(`Please choose ${qrType === 'image' ? 'an image' : qrType === 'video' ? 'a video' : 'a file'} first.`);
        return;
      }

      setBusy(true);
      setUploadPct(0);
      setStatusLabel('Uploading... 0%');

      try {
        const token = await getToken();
        const formData = new FormData();
        formData.append('qrType', qrType);
        formData.append('name', qrName.trim() || selectedFile.name.replace(/\.[^.]+$/, ''));
        formData.append('expiration', expiration);
        if (customExpiresAt) formData.append('customExpiresAt', customExpiresAt);
        formData.append('design', JSON.stringify(design));
        if (videoMeta?.durationSec) {
          formData.append('clientDurationSec', String(videoMeta.durationSec));
        }
        formData.append('file', selectedFile);
        if (videoMeta?.thumbnailBlob) {
          formData.append('thumbnail', videoMeta.thumbnailBlob, 'thumb.jpg');
        }

        const respData = await new Promise<{ record: CreatedQrResult }>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/api/qr/upload');
          if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

          xhr.upload.onprogress = (evt) => {
            if (evt.lengthComputable && evt.total > 0) {
              const pct = Math.min(99, Math.round((evt.loaded / evt.total) * 100));
              setUploadPct(pct);
              setStatusLabel(pct >= 99 ? 'Creating QR...' : `Uploading... ${pct}%`);
            }
          };

          xhr.onload = () => {
            setStatusLabel('Creating QR...');
            try {
              const json = JSON.parse(xhr.responseText || '{}');
              if (xhr.status >= 200 && xhr.status < 300 && json.record) {
                resolve(json);
              } else {
                reject(new Error(json.error || 'Upload failed. Please try again.'));
              }
            } catch {
              reject(new Error('Upload failed. Please try again.'));
            }
          };

          xhr.onerror = () => reject(new Error('Network interrupted during upload. Please try again.'));
          xhr.send(formData);
        });

        const rec: CreatedQrResult = {
          ...respData.record,
          design,
        };
        setResult(rec);
        setPhase('result');
        saveLocalHistory([rec, ...localHistory.filter((i) => i.shareId !== rec.shareId)]);

        if (user) {
          void syncQrToFirestore({
            userId: user.uid,
            shareId: rec.shareId,
            name: rec.name,
            qrType: rec.qrType,
            payload: rec.payload,
            shareUrl: rec.shareUrl,
            mimeType: rec.mimeType,
            fileName: rec.fileName,
            sizeBytes: rec.sizeBytes,
            thumbnailUrl: rec.thumbnailUrl,
            design,
            expiresAt: rec.expiresAt,
          });
        }

        void logClientToolExecution({
          toolId: tool.id,
          toolName: tool.name,
          category: tool.category,
          fileName: rec.fileName || rec.name,
          inputSizeBytes: selectedFile.size,
        });
        notify('QR code created and ready!', 'success');
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'Could not create QR.');
      } finally {
        setBusy(false);
        setUploadPct(0);
        setStatusLabel('');
      }
      return;
    }

    // Structured payload QR (Link, Text, Contact, Wi-Fi, Email, Phone, Location)
    const payload = buildQrPayloadFromForm(qrType, {
      url: urlVal,
      text: textVal,
      contactName,
      contactPhone,
      contactEmail,
      contactOrg,
      contactUrl,
      wifiSsid,
      wifiPassword,
      wifiSecurity,
      wifiHidden,
      emailTo,
      emailSubject,
      emailBody,
      phoneNumber,
      lat,
      lng,
    });

    if (!payload) {
      setFormError('Please fill in the required fields to create your QR code.');
      return;
    }

    if (qrType === 'link') {
      try {
        new URL(payload);
      } catch {
        setFormError('Please enter a valid website URL.');
        return;
      }
    }

    setBusy(true);
    setStatusLabel('Creating QR...');

    try {
      const token = await getToken();
      const defaultTitleMap: Record<QrContentType, string> = {
        link: payload.replace(/^https?:\/\//i, '').slice(0, 60),
        text: payload.slice(0, 48),
        contact: contactName || 'Contact Card',
        wifi: wifiSsid ? `Wi-Fi: ${wifiSsid}` : 'Wi-Fi Network',
        email: emailTo ? `Email: ${emailTo}` : 'Email QR',
        phone: phoneNumber ? `Call: ${phoneNumber}` : 'Phone QR',
        location: `Location (${lat}, ${lng})`,
        image: 'Image QR',
        video: 'Video QR',
        file: 'File QR',
      };
      const finalName = qrName.trim() || defaultTitleMap[qrType] || 'RIKZEN QR';

      const res = await fetch('/api/qr/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          qrType,
          name: finalName,
          payload,
          expiration,
          customExpiresAt,
          design,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.record) {
        throw new Error(json.error || 'Could not create QR code.');
      }

      const rec: CreatedQrResult = {
        ...json.record,
        design,
      };
      setResult(rec);
      setPhase('result');
      saveLocalHistory([rec, ...localHistory.filter((i) => i.shareId !== rec.shareId)]);

      if (user) {
        void syncQrToFirestore({
          userId: user.uid,
          shareId: rec.shareId,
          name: rec.name,
          qrType: rec.qrType,
          payload: rec.payload,
          shareUrl: rec.shareUrl,
          sizeBytes: rec.sizeBytes,
          design,
          expiresAt: rec.expiresAt,
        });
      }

      void logClientToolExecution({
        toolId: tool.id,
        toolName: tool.name,
        category: tool.category,
        fileName: finalName,
      });
      notify('QR code created and ready!', 'success');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create QR code.');
    } finally {
      setBusy(false);
      setStatusLabel('');
    }
  };

  const applyTemplate = (tplId: QrDesignConfig['template']) => {
    const preset = QR_TEMPLATES.find((t) => t.id === tplId);
    if (!preset) return;
    setDesign((prev) => ({ ...prev, ...preset.design }));
  };

  const handleDownloadPng = async () => {
    if (!result) return;
    try {
      const { blob } = await renderQrPngBlob(result.payload, design, design.resolution);
      const slug = result.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'rikzen-qr';
      triggerBlobSave(blob, `${slug}-${design.resolution}px.png`);
      void trackAnalyticsEvent('download_clicked', tool.id, tool.category);
      notify(`PNG (${design.resolution}px) downloaded.`, 'success');
    } catch {
      notify('Could not export PNG.', 'error');
    }
  };

  const handleDownloadSvg = () => {
    if (!result || !renderedQr) return;
    const slug = result.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'rikzen-qr';
    const blob = new Blob([renderedQr.svgString], { type: 'image/svg+xml;charset=utf-8' });
    triggerBlobSave(blob, `${slug}.svg`);
    void trackAnalyticsEvent('download_clicked', tool.id, tool.category);
    notify('SVG downloaded.', 'success');
  };

  const handleDownloadPdf = async () => {
    if (!result) return;
    setPdfDownloading(true);
    try {
      const token = await getToken();
      const { dataUrl } = await renderQrPngBlob(result.payload, design, 1024);
      const res = await fetch('/api/qr/pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          title: result.name,
          subtitle: ['image', 'video', 'file'].includes(result.qrType)
            ? result.shareUrl
            : result.payload.slice(0, 90),
          payload: result.payload,
          pngDataUrl: dataUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'PDF export failed.');
      await downloadFileSafely({
        url: data.downloadUrl,
        fileName: data.fileName,
        mimeType: 'application/pdf',
      });
      void trackAnalyticsEvent('download_clicked', tool.id, tool.category);
      notify('Printable PDF downloaded.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'PDF download failed.', 'error');
    } finally {
      setPdfDownloading(false);
    }
  };

  const handleShare = async () => {
    if (!result) return;
    const shareTarget = ['image', 'video', 'file'].includes(result.qrType)
      ? result.shareUrl
      : result.payload;
    try {
      const { blob } = await renderQrPngBlob(result.payload, design, 1024);
      const file = new File([blob], 'rikzen-qr.png', { type: 'image/png' });
      if (navigator.share) {
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({
            title: result.name,
            text: `Scan this RIKZEN QR code: ${result.name}`,
            url: result.shareUrl,
            files: [file],
          });
          return;
        }
        await navigator.share({
          title: result.name,
          text: shareTarget,
          url: result.shareUrl,
        });
        return;
      }
      await navigator.clipboard?.writeText(result.shareUrl);
      notify('QR share link copied.', 'success');
    } catch {
      await navigator.clipboard?.writeText(result.shareUrl);
      notify('QR share link copied.', 'success');
    }
  };

  const resetToCreate = () => {
    setPhase('form');
    setResult(null);
    setShowCustomize(false);
    setFormError(null);
  };

  return (
    <div className="space-y-7">
      {/* Studio Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-[#C9A227]/15 text-[#B88E1E] dark:text-[#D4AF37] flex items-center justify-center">
            <QrCode className="w-5 h-5" />
          </span>
          <div>
            <h2 className="text-base font-extrabold text-[#111214] dark:text-[#F4F4F0] leading-tight">
              {phase === 'result' ? 'QR Ready' : 'Create QR'}
            </h2>
            <p className="text-xs text-[#6B707B] dark:text-[#9CA0AA]">
              Links, images, videos, files, Wi-Fi &amp; contacts
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex p-1 rounded-xl border border-[#E2DED4] dark:border-[#262B37] bg-[#F4F1EA] dark:bg-[#0D1015]">
            <button
              type="button"
              onClick={() => {
                setStudioMode('single');
                setFormError(null);
              }}
              className={`min-h-[32px] px-3 rounded-lg text-xs font-bold cursor-pointer ${
                studioMode === 'single'
                  ? 'bg-white dark:bg-[#1E232E] text-[#111214] dark:text-[#F4F4F0] shadow-xs'
                  : 'text-[#6B707B] dark:text-[#9CA0AA]'
              }`}
            >
              Single QR
            </button>
            <button
              type="button"
              onClick={() => {
                setStudioMode('batch');
                setPhase('form');
                setFormError(null);
              }}
              className={`min-h-[32px] px-3 rounded-lg text-xs font-bold inline-flex items-center gap-1 cursor-pointer ${
                studioMode === 'batch'
                  ? 'bg-white dark:bg-[#1E232E] text-[#111214] dark:text-[#F4F4F0] shadow-xs'
                  : 'text-[#6B707B] dark:text-[#9CA0AA]'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-[#C9A227]" />
              <span>Batch ({maxBatchFiles})</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => onNavigate?.('/tools/qr-scanner')}
            className="min-h-[38px] px-3.5 rounded-xl border border-[#E2DED4] dark:border-[#262B37] text-xs font-semibold inline-flex items-center gap-1.5 hover:border-[#C9A227] cursor-pointer"
          >
            <ScanLine className="w-3.5 h-3.5 text-[#C9A227]" />
            <span>Scan QR</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate?.('/qr-codes')}
            className="min-h-[38px] px-3.5 rounded-xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>My QR Codes</span>
          </button>
        </div>
      </div>

      {/* BATCH QR GENERATOR MODE (Up to 50 URLs or Files/Images) */}
      {studioMode === 'batch' && (
        <div className="space-y-6">
          <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-5 sm:p-7 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setBatchQrKind('urls');
                  setFormError(null);
                }}
                className={`rounded-2xl border p-4 text-left flex items-center gap-3 transition-all cursor-pointer ${
                  batchQrKind === 'urls'
                    ? 'border-[#C9A227] bg-[#C9A227]/12 ring-1 ring-[#C9A227]/40'
                    : 'border-[#E2DED4] dark:border-[#232833] hover:border-[#C9A227]/60'
                }`}
              >
                <span className="w-10 h-10 rounded-xl bg-[#C9A227]/15 text-[#B88E1E] dark:text-[#D4AF37] flex items-center justify-center shrink-0">
                  <Link2 className="w-5 h-5" />
                </span>
                <div>
                  <div className="text-sm font-bold text-[#111214] dark:text-[#F4F4F0]">
                    URLs → QR Batch
                  </div>
                  <div className="text-xs text-[#6B707B] dark:text-[#9CA0AA]">
                    Paste up to {maxBatchFiles} direct links or image URLs
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setBatchQrKind('files');
                  setFormError(null);
                }}
                className={`rounded-2xl border p-4 text-left flex items-center gap-3 transition-all cursor-pointer ${
                  batchQrKind === 'files'
                    ? 'border-[#C9A227] bg-[#C9A227]/12 ring-1 ring-[#C9A227]/40'
                    : 'border-[#E2DED4] dark:border-[#232833] hover:border-[#C9A227]/60'
                }`}
              >
                <span className="w-10 h-10 rounded-xl bg-[#C9A227]/15 text-[#B88E1E] dark:text-[#D4AF37] flex items-center justify-center shrink-0">
                  <Upload className="w-5 h-5" />
                </span>
                <div>
                  <div className="text-sm font-bold text-[#111214] dark:text-[#F4F4F0]">
                    Upload Images / Files → QR Batch
                  </div>
                  <div className="text-xs text-[#6B707B] dark:text-[#9CA0AA]">
                    Up to {maxBatchFiles} files · ZIP export
                  </div>
                </div>
              </button>
            </div>

            {batchQrKind === 'urls' ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-[#111214] dark:text-[#F4F4F0]">
                    Paste Links (One URL per line · Max {maxBatchFiles})
                  </span>
                  <span className="font-mono text-[#6B707B] dark:text-[#9CA0AA]">
                    {batchUrlsText.split(/\r?\n/).filter((l) => l.trim()).length} / {maxBatchFiles}
                  </span>
                </div>
                <textarea
                  rows={6}
                  value={batchUrlsText}
                  onChange={(e) => setBatchUrlsText(e.target.value)}
                  placeholder={`https://example.com\nhttps://example.com/photo.jpg\nhttps://example.com/menu`}
                  className="w-full rounded-2xl border border-[#DAD4C7] dark:border-[#2B303C] bg-[#FAF8F4] dark:bg-[#0D1015] p-4 text-xs sm:text-sm font-mono focus:outline-none focus:border-[#C9A227]"
                />
              </div>
            ) : (
              <UploadZone
                accept="image/*,.pdf,.doc,.docx,.xlsx,.zip,.txt"
                supportedFormats={['JPG', 'PNG', 'WebP', 'PDF', 'Files']}
                maxSizeMb={capabilities.maxQrFileMb || 50}
                maxFiles={maxBatchFiles}
                maxTotalMb={capabilities.maxTotalBatchSizeMb || 1000}
                multiple
                hideFileList={batchFiles.length > 1}
                compactWhenHasFiles={batchFiles.length > 0}
                files={batchFiles}
                onFilesSelected={(items) => {
                  setBatchFiles(items);
                  setBatchQueue([]);
                  setFormError(null);
                }}
                onRemoveFile={(idx) => {
                  setBatchFiles((prev) => {
                    const target = prev[idx];
                    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
                    return prev.filter((_, i) => i !== idx);
                  });
                }}
              />
            )}

            {formError && (
              <div className="rounded-2xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <button
              type="button"
              disabled={batchBusy}
              onClick={() => void handleCreateBatchQrs()}
              className="w-full min-h-[50px] rounded-2xl bg-gradient-to-b from-[#1A1C22] to-[#0B0D11] dark:from-[#E5C453] dark:to-[#C59D24] text-white dark:text-[#0B0C0E] text-sm font-bold flex items-center justify-center gap-2 shadow-sm hover:opacity-95 cursor-pointer disabled:opacity-60"
            >
              {batchBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <span>{batchBusy ? 'Creating Batch QRs...' : 'Create All QR Codes'}</span>
            </button>
          </div>

          {(batchQueue.length > 0 || (batchQrKind === 'files' && batchFiles.length > 0)) && (
            <BatchStatusTable
              items={
                batchQueue.length > 0
                  ? batchQueue
                  : batchFiles.map((f, idx) => ({
                      id: `pre-${idx}-${f.file.name}`,
                      fileName: f.file.name,
                      sizeBytes: f.file.size,
                      thumbnailUrl: f.previewUrl,
                      status: 'ready',
                    }))
              }
              processing={batchBusy}
              zipBusy={batchZipBusy}
              downloadAllLabel="Download All (PNG ZIP)"
              onStartProcessing={() => void handleCreateBatchQrs()}
              onClearAll={() => {
                batchFiles.forEach((f) => {
                  if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
                });
                batchQueue.forEach((q) => {
                  if (q.downloadUrl && q.downloadUrl.startsWith('blob:')) {
                    URL.revokeObjectURL(q.downloadUrl);
                  }
                });
                setBatchFiles([]);
                setBatchQueue([]);
                setBatchUrlsText('');
              }}
              onDownloadItem={(item) => {
                const match = batchQueue.find((q) => q.id === item.id);
                if (match?.pngBlob && match.downloadFileName) {
                  triggerBlobSave(match.pngBlob, match.downloadFileName);
                }
              }}
              onDownloadAll={() => void handleDownloadAllBatchQrs()}
              onRemoveItem={(id) => {
                setBatchQueue((prev) => prev.filter((q) => q.id !== id));
                if (id.startsWith('pre-')) {
                  const idx = Number(id.split('-')[1]);
                  if (Number.isInteger(idx)) {
                    setBatchFiles((prev) => {
                      const target = prev[idx];
                      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
                      return prev.filter((_, i) => i !== idx);
                    });
                  }
                }
              }}
            />
          )}
        </div>
      )}

      {/* PHASE 1: CREATE QR */}
      {studioMode === 'single' && phase === 'form' && (
        <div className="space-y-6">
          {/* 10 Large Visual QR Type Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 sm:gap-3">
            {QR_TYPE_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const active = qrType === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleSelectType(opt.id)}
                  className={`rounded-2xl border p-3.5 sm:p-4 text-left transition-all active:scale-[0.98] cursor-pointer flex items-center sm:flex-col sm:items-start gap-3 sm:gap-2.5 ${
                    active
                      ? 'border-[#C9A227] bg-[#C9A227]/12 dark:bg-[#D4AF37]/14 shadow-sm ring-1 ring-[#C9A227]/40'
                      : 'border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] hover:border-[#C9A227]/60'
                  }`}
                >
                  <span
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      active
                        ? 'bg-[#C9A227] text-[#0B0C0E]'
                        : 'bg-[#F4F1EA] dark:bg-[#1A1E26] text-[#111214] dark:text-[#D4AF37]'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-[#111214] dark:text-[#F4F4F0] leading-tight">
                      {opt.label}
                    </div>
                    <div className="text-[11px] text-[#6B707B] dark:text-[#9CA0AA] truncate mt-0.5">
                      {opt.hint}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Focused Input Card */}
          <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-5 sm:p-7 space-y-5">
            {/* Common QR Name & Expiration row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">
                  QR Name (Optional)
                </span>
                <input
                  type="text"
                  value={qrName}
                  onChange={(e) => setQrName(e.target.value)}
                  maxLength={140}
                  placeholder="e.g., Menu QR, Demo Video, Wi-Fi Guest"
                  className="w-full min-h-[44px] rounded-xl border border-[#DAD4C7] dark:border-[#2B303C] bg-[#FAF8F4] dark:bg-[#0D1015] px-3.5 text-sm focus:outline-none focus:border-[#C9A227]"
                />
              </label>

              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA] block">
                  Expiration (Optional)
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {EXPIRATION_OPTIONS.map((exp) => (
                    <button
                      key={exp.id}
                      type="button"
                      onClick={() => setExpiration(exp.id)}
                      className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                        expiration === exp.id
                          ? 'border-[#C9A227] bg-[#C9A227]/15 text-[#9A7410] dark:text-[#D4AF37]'
                          : 'border-[#E2DED4] dark:border-[#262B37] text-[#5A5D65] dark:text-[#9CA0AA]'
                      }`}
                    >
                      {exp.label}
                    </button>
                  ))}
                </div>
                {expiration === 'custom' && (
                  <input
                    type="date"
                    value={customDate}
                    min={new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}
                    onChange={(e) => setCustomDate(e.target.value)}
                    className="mt-2 w-full min-h-[42px] rounded-xl border border-[#DAD4C7] dark:border-[#2B303C] bg-[#FAF8F4] dark:bg-[#0D1015] px-3 text-sm"
                  />
                )}
              </div>
            </div>

            {/* Type-specific inputs */}
            {qrType === 'link' && (
              <div className="space-y-2">
                <label className="block space-y-1.5">
                  <span className="text-sm font-bold">Paste your link</span>
                  <input
                    type="url"
                    value={urlVal}
                    onChange={(e) => setUrlVal(e.target.value)}
                    placeholder="https://example.com"
                    className="w-full min-h-[48px] rounded-2xl border border-[#DAD4C7] dark:border-[#2B303C] bg-[#FAF8F4] dark:bg-[#0D1015] px-4 text-sm focus:outline-none focus:border-[#C9A227]"
                  />
                </label>
                <p className="text-xs text-[#6B707B] dark:text-[#9CA0AA]">
                  Direct Link — Scanning opens your exact destination URL directly without passing through an intermediate RIKZEN page.
                </p>
              </div>
            )}

            {qrType === 'text' && (
              <label className="block space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-sm font-bold">Text Content</span>
                  <span className="text-xs font-mono text-[#8E939E]">{textVal.length}/2000</span>
                </div>
                <textarea
                  rows={4}
                  maxLength={2000}
                  value={textVal}
                  onChange={(e) => setTextVal(e.target.value)}
                  placeholder="Type or paste any text..."
                  className="w-full rounded-2xl border border-[#DAD4C7] dark:border-[#2B303C] bg-[#FAF8F4] dark:bg-[#0D1015] p-4 text-sm focus:outline-none focus:border-[#C9A227]"
                />
              </label>
            )}

            {qrType === 'contact' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <label className="block space-y-1">
                  <span className="text-xs font-semibold">Full Name *</span>
                  <input
                    type="text"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="Aarav Sharma"
                    className="w-full min-h-[44px] rounded-xl border border-[#DAD4C7] dark:border-[#2B303C] bg-[#FAF8F4] dark:bg-[#0D1015] px-3.5 text-sm"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold">Phone Number</span>
                  <input
                    type="tel"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="w-full min-h-[44px] rounded-xl border border-[#DAD4C7] dark:border-[#2B303C] bg-[#FAF8F4] dark:bg-[#0D1015] px-3.5 text-sm"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold">Email</span>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="w-full min-h-[44px] rounded-xl border border-[#DAD4C7] dark:border-[#2B303C] bg-[#FAF8F4] dark:bg-[#0D1015] px-3.5 text-sm"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold">Company / Role</span>
                  <input
                    type="text"
                    value={contactOrg}
                    onChange={(e) => setContactOrg(e.target.value)}
                    placeholder="RIKZEN Studio"
                    className="w-full min-h-[44px] rounded-xl border border-[#DAD4C7] dark:border-[#2B303C] bg-[#FAF8F4] dark:bg-[#0D1015] px-3.5 text-sm"
                  />
                </label>
                <label className="block space-y-1 sm:col-span-2">
                  <span className="text-xs font-semibold">Website (Optional)</span>
                  <input
                    type="url"
                    value={contactUrl}
                    onChange={(e) => setContactUrl(e.target.value)}
                    placeholder="https://example.com"
                    className="w-full min-h-[44px] rounded-xl border border-[#DAD4C7] dark:border-[#2B303C] bg-[#FAF8F4] dark:bg-[#0D1015] px-3.5 text-sm"
                  />
                </label>
              </div>
            )}

            {qrType === 'wifi' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <label className="block space-y-1">
                  <span className="text-xs font-semibold">Network Name (SSID) *</span>
                  <input
                    type="text"
                    value={wifiSsid}
                    onChange={(e) => setWifiSsid(e.target.value)}
                    placeholder="MyHomeWiFi"
                    className="w-full min-h-[44px] rounded-xl border border-[#DAD4C7] dark:border-[#2B303C] bg-[#FAF8F4] dark:bg-[#0D1015] px-3.5 text-sm"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold">Security</span>
                  <select
                    value={wifiSecurity}
                    onChange={(e) => setWifiSecurity(e.target.value as 'WPA' | 'WEP' | 'nopass')}
                    className="w-full min-h-[44px] rounded-xl border border-[#DAD4C7] dark:border-[#2B303C] bg-[#FAF8F4] dark:bg-[#0D1015] px-3.5 text-sm"
                  >
                    <option value="WPA">WPA / WPA2 / WPA3</option>
                    <option value="WEP">WEP</option>
                    <option value="nopass">Open (No Password)</option>
                  </select>
                </label>
                {wifiSecurity !== 'nopass' && (
                  <label className="block space-y-1 sm:col-span-2">
                    <span className="text-xs font-semibold">Wi-Fi Password</span>
                    <div className="relative flex items-center">
                      <input
                        type={showWifiPass ? 'text' : 'password'}
                        value={wifiPassword}
                        onChange={(e) => setWifiPassword(e.target.value)}
                        placeholder="Enter network password"
                        className="w-full min-h-[44px] rounded-xl border border-[#DAD4C7] dark:border-[#2B303C] bg-[#FAF8F4] dark:bg-[#0D1015] pl-3.5 pr-11 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowWifiPass((s) => !s)}
                        aria-label="Toggle password visibility"
                        className="absolute right-2 min-h-[36px] min-w-[36px] flex items-center justify-center text-[#6B707B] cursor-pointer"
                      >
                        {showWifiPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </label>
                )}
                <label className="inline-flex items-center gap-2 text-xs font-semibold cursor-pointer sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={wifiHidden}
                    onChange={(e) => setWifiHidden(e.target.checked)}
                    className="w-4 h-4 accent-[#C9A227]"
                  />
                  <span>Hidden Wi-Fi Network</span>
                </label>
              </div>
            )}

            {qrType === 'email' && (
              <div className="space-y-3.5">
                <label className="block space-y-1">
                  <span className="text-xs font-semibold">Recipient Email *</span>
                  <input
                    type="email"
                    value={emailTo}
                    onChange={(e) => setEmailTo(e.target.value)}
                    placeholder="hello@example.com"
                    className="w-full min-h-[44px] rounded-xl border border-[#DAD4C7] dark:border-[#2B303C] bg-[#FAF8F4] dark:bg-[#0D1015] px-3.5 text-sm"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold">Subject</span>
                  <input
                    type="text"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    placeholder="Quick inquiry"
                    className="w-full min-h-[44px] rounded-xl border border-[#DAD4C7] dark:border-[#2B303C] bg-[#FAF8F4] dark:bg-[#0D1015] px-3.5 text-sm"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold">Message</span>
                  <textarea
                    rows={3}
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    placeholder="Optional pre-filled email body..."
                    className="w-full rounded-xl border border-[#DAD4C7] dark:border-[#2B303C] bg-[#FAF8F4] dark:bg-[#0D1015] p-3.5 text-sm"
                  />
                </label>
              </div>
            )}

            {qrType === 'phone' && (
              <label className="block space-y-1.5">
                <span className="text-sm font-bold">Phone Number</span>
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+1 555 234 5678"
                  className="w-full min-h-[48px] rounded-2xl border border-[#DAD4C7] dark:border-[#2B303C] bg-[#FAF8F4] dark:bg-[#0D1015] px-4 text-sm focus:outline-none focus:border-[#C9A227]"
                />
              </label>
            )}

            {qrType === 'location' && (
              <div className="space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <label className="block space-y-1">
                    <span className="text-xs font-semibold">Latitude *</span>
                    <input
                      type="text"
                      value={lat}
                      onChange={(e) => setLat(e.target.value)}
                      placeholder="28.6139"
                      className="w-full min-h-[44px] rounded-xl border border-[#DAD4C7] dark:border-[#2B303C] bg-[#FAF8F4] dark:bg-[#0D1015] px-3.5 text-sm font-mono"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs font-semibold">Longitude *</span>
                    <input
                      type="text"
                      value={lng}
                      onChange={(e) => setLng(e.target.value)}
                      placeholder="77.2090"
                      className="w-full min-h-[44px] rounded-xl border border-[#DAD4C7] dark:border-[#2B303C] bg-[#FAF8F4] dark:bg-[#0D1015] px-3.5 text-sm font-mono"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={detectLocation}
                  disabled={locLoading}
                  className="min-h-[40px] px-4 rounded-xl border border-[#DAD4C7] dark:border-[#2B303C] text-xs font-semibold inline-flex items-center gap-2 hover:border-[#C9A227] cursor-pointer"
                >
                  {locLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5 text-[#C9A227]" />}
                  <span>Use Current Location</span>
                </button>
              </div>
            )}

            {/* IMAGE / VIDEO / FILE UPLOADERS + IMAGE URL OPTION */}
            {['image', 'video', 'file'].includes(qrType) && (
              <div className="space-y-4">
                {qrType === 'image' && (
                  <div className="inline-flex p-1 rounded-2xl border border-[#E2DED4] dark:border-[#232833] bg-[#F4F1EA] dark:bg-[#0D1015]">
                    <button
                      type="button"
                      onClick={() => setImageInputMode('upload')}
                      className={`min-h-[38px] px-4 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                        imageInputMode === 'upload'
                          ? 'bg-white dark:bg-[#1E232E] text-[#111214] dark:text-[#F4F4F0] shadow-xs'
                          : 'text-[#6B707B] dark:text-[#9CA0AA]'
                      }`}
                    >
                      📤 Upload Image
                    </button>
                    <button
                      type="button"
                      onClick={() => setImageInputMode('url')}
                      className={`min-h-[38px] px-4 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                        imageInputMode === 'url'
                          ? 'bg-white dark:bg-[#1E232E] text-[#111214] dark:text-[#F4F4F0] shadow-xs'
                          : 'text-[#6B707B] dark:text-[#9CA0AA]'
                      }`}
                    >
                      🖼️ Image URL
                    </button>
                  </div>
                )}

                {qrType === 'image' && imageInputMode === 'url' ? (
                  <div className="space-y-3">
                    {!directImageUrlMeta ? (
                      <ImageUrlLoader
                        compact
                        actionLabel="Use Image URL"
                        onUseImage={handleLoadedQrImageUrl}
                      />
                    ) : (
                      <div className="rounded-2xl border border-[#C9A227]/45 bg-[#FAF8F4] dark:bg-[#0D1015] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-3.5 min-w-0">
                          {directImagePreviewUrl && (
                            <img
                              src={directImagePreviewUrl}
                              alt={directImageUrlMeta.fileName}
                              className="w-16 h-16 rounded-xl object-cover border border-[#E2DED4] dark:border-[#262B37] shrink-0"
                            />
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-[#111214] dark:text-[#F4F4F0] truncate">
                              {directImageUrlMeta.fileName}
                            </p>
                            <p className="text-xs text-[#6B707B] dark:text-[#9CA0AA] font-mono tabular-nums">
                              {directImageUrlMeta.format} · {directImageUrlMeta.width}×{directImageUrlMeta.height} px · {formatBytes(directImageUrlMeta.sizeBytes)}
                            </p>
                            <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium mt-0.5 truncate">
                              Encodes direct image URL: {directImageUrlMeta.originalUrl}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            if (directImagePreviewUrl) URL.revokeObjectURL(directImagePreviewUrl);
                            setDirectImagePreviewUrl(null);
                            setDirectImageUrlMeta(null);
                          }}
                          className="min-h-[38px] px-3.5 rounded-xl border border-[#DAD4C7] dark:border-[#2C3240] bg-white dark:bg-[#151820] text-xs font-semibold shrink-0 cursor-pointer hover:border-[#C9A227]"
                        >
                          Change
                        </button>
                      </div>
                    )}
                    <p className="text-[11px] text-[#6B707B] dark:text-[#9CA0AA]">
                      Your QR code points directly to the image URL without downloading or re-uploading it.
                    </p>
                  </div>
                ) : (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={
                        qrType === 'image'
                          ? 'image/jpeg,image/png,image/webp,image/gif'
                          : qrType === 'video'
                          ? 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm'
                          : '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt,.csv,.json'
                      }
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handlePickMediaFile(f);
                        e.target.value = '';
                      }}
                      className="hidden"
                    />

                    {!selectedFile ? (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full rounded-2xl border-2 border-dashed border-[#D6D0C2] dark:border-[#2C3240] bg-[#FAF8F4] dark:bg-[#0D1015] hover:border-[#C9A227] p-8 flex flex-col items-center justify-center text-center gap-3 transition-colors cursor-pointer"
                      >
                        <span className="w-14 h-14 rounded-2xl bg-[#C9A227]/15 text-[#B88E1E] dark:text-[#D4AF37] flex items-center justify-center">
                          <Upload className="w-6 h-6" />
                        </span>
                        <div>
                          <p className="text-base font-bold text-[#111214] dark:text-[#F4F4F0]">
                            {qrType === 'image'
                              ? 'Upload Image'
                              : qrType === 'video'
                              ? 'Upload Video'
                              : 'Upload File'}
                          </p>
                          <p className="text-xs text-[#6B707B] dark:text-[#9CA0AA] mt-1">
                            {qrType === 'image'
                              ? `JPG, PNG, WebP, GIF · Max ${capabilities.maxQrImageMb} MB`
                              : qrType === 'video'
                              ? `MP4, MOV, WebM · Max ${capabilities.maxQrVideoMb} MB`
                              : `PDF, DOCX, XLSX, ZIP, TXT · Max ${capabilities.maxQrFileMb} MB`}
                          </p>
                        </div>
                      </button>
                    ) : (
                      <div className="rounded-2xl border border-[#E2DED4] dark:border-[#262B37] bg-[#FAF8F4] dark:bg-[#0D1015] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-3.5 min-w-0">
                          {qrType === 'image' && imagePreviewUrl ? (
                            <img
                              src={imagePreviewUrl}
                              alt={selectedFile.name}
                              className="w-16 h-16 rounded-xl object-cover border border-[#E2DED4] dark:border-[#262B37] shrink-0"
                            />
                          ) : qrType === 'video' && videoMeta?.thumbnailDataUrl ? (
                            <div className="relative w-20 h-16 rounded-xl overflow-hidden bg-black shrink-0 border border-[#E2DED4] dark:border-[#262B37]">
                              <img
                                src={videoMeta.thumbnailDataUrl}
                                alt="Video preview"
                                className="w-full h-full object-cover"
                              />
                            </div>
                          ) : (
                            <span className="w-14 h-14 rounded-xl bg-[#C9A227]/15 text-[#B88E1E] dark:text-[#D4AF37] flex items-center justify-center shrink-0">
                              {qrType === 'video' ? <Film className="w-6 h-6" /> : <FileText className="w-6 h-6" />}
                            </span>
                          )}

                          <div className="min-w-0">
                            <p className="text-sm font-bold text-[#111214] dark:text-[#F4F4F0] truncate">
                              {selectedFile.name}
                            </p>
                            <p className="text-xs text-[#6B707B] dark:text-[#9CA0AA] mt-0.5 font-mono tabular-nums">
                              {formatBytes(selectedFile.size)}
                              {videoMeta?.durationSec ? ` · ${formatDuration(videoMeta.durationSec)}` : ''}
                              {videoMeta?.width && videoMeta?.height ? ` · ${videoMeta.width}×${videoMeta.height}` : ''}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="min-h-[38px] px-3.5 rounded-xl border border-[#DAD4C7] dark:border-[#2C3240] bg-white dark:bg-[#151820] text-xs font-semibold shrink-0 cursor-pointer hover:border-[#C9A227]"
                        >
                          Change
                        </button>
                      </div>
                    )}

                    <p className="text-[11px] text-[#6B707B] dark:text-[#9CA0AA]">
                      Files are hosted securely on RIKZEN and connected via a short unguessable QR link.
                    </p>
                  </>
                )}
              </div>
            )}

            {formError && (
              <div className="rounded-2xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {busy && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-semibold text-[#B88E1E] dark:text-[#D4AF37]">
                  <span>{statusLabel || 'Creating QR...'}</span>
                  {uploadPct > 0 && <span className="font-mono tabular-nums">{uploadPct}%</span>}
                </div>
                <div className="h-2 rounded-full bg-[#EFECE4] dark:bg-[#1E222C] overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#B88E1E] to-[#E5C453] transition-all duration-200"
                    style={{ width: `${Math.max(12, uploadPct)}%` }}
                  />
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={busy}
              onClick={() => void handleCreateQr()}
              className="w-full min-h-[52px] rounded-2xl bg-gradient-to-b from-[#1A1C22] to-[#0B0D11] dark:from-[#E5C453] dark:to-[#C59D24] text-white dark:text-[#0B0C0E] text-sm font-bold flex items-center justify-center gap-2 shadow-sm hover:opacity-95 transition-all active:scale-[0.99] cursor-pointer disabled:opacity-60"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <span>{busy ? statusLabel || 'Creating QR...' : 'Create QR'}</span>
            </button>
          </div>
        </div>
      )}

      {/* PHASE 2: QR RESULT PAGE */}
      {studioMode === 'single' && phase === 'result' && result && (
        <div className="space-y-6">
          <div className="rikzen-card rounded-3xl border border-[#C9A227]/45 bg-white dark:bg-[#12151B] p-5 sm:p-8 space-y-6">
            {/* Result Status Header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 text-xs font-bold">
                <CheckCircle2 className="w-4 h-4" />
                <span>QR Ready</span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {renderedQr && (
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold ${
                      renderedQr.scannable && !renderedQr.lowContrast
                        ? 'bg-[#C9A227]/12 text-[#9A7410] dark:text-[#D4AF37]'
                        : 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                    }`}
                  >
                    {renderedQr.scannable && !renderedQr.lowContrast ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Verified Scannable</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Low contrast — increase contrast for easy scan</span>
                      </>
                    )}
                  </span>
                )}

                <button
                  type="button"
                  onClick={resetToCreate}
                  className="min-h-[36px] px-3.5 rounded-xl border border-[#DAD4C7] dark:border-[#2B303C] text-xs font-semibold inline-flex items-center gap-1.5 hover:border-[#C9A227] cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Create Another</span>
                </button>
              </div>
            </div>

            {/* Large QR Preview + Details */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-center">
              <div className="lg:col-span-5 flex flex-col items-center">
                <div
                  className="p-5 rounded-3xl border border-[#E2DED4] dark:border-[#262B37] shadow-sm inline-block"
                  style={{
                    backgroundColor: design.transparentBg ? 'transparent' : design.bgColor,
                    backgroundImage: design.transparentBg
                      ? 'repeating-conic-gradient(#e5e5e0 0% 25%, #ffffff 0% 50%)'
                      : undefined,
                    backgroundSize: design.transparentBg ? '16px 16px' : undefined,
                  }}
                >
                  {renderedQr ? (
                    <img
                      src={renderedQr.dataUrl}
                      alt={result.name}
                      className="w-64 h-64 sm:w-72 sm:h-72 object-contain rounded-xl"
                    />
                  ) : (
                    <div className="w-64 h-64 flex items-center justify-center text-sm text-[#8E939E]">
                      Rendering QR...
                    </div>
                  )}
                </div>
              </div>

              <div className="lg:col-span-7 space-y-5">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#B88E1E] dark:text-[#D4AF37]">
                    {result.qrType.toUpperCase()} QR
                  </span>
                  <h3 className="text-2xl font-extrabold text-[#111214] dark:text-[#F4F4F0] mt-0.5 break-words">
                    {result.name}
                  </h3>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-2xl border border-[#E2DED4] dark:border-[#262B37] bg-[#FAF8F4] dark:bg-[#0D1015] px-3.5 py-2.5 text-xs">
                    <span className="font-mono text-[#5A5D65] dark:text-[#9CA0AA] truncate flex-1">
                      {['image', 'video', 'file'].includes(result.qrType) ? result.shareUrl : result.payload}
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        const target = ['image', 'video', 'file'].includes(result.qrType)
                          ? result.shareUrl
                          : result.payload;
                        await navigator.clipboard?.writeText(target);
                        notify('Copied to clipboard.', 'success');
                      }}
                      className="font-semibold text-[#B88E1E] dark:text-[#D4AF37] inline-flex items-center gap-1 cursor-pointer shrink-0"
                    >
                      <Copy className="w-3.5 h-3.5" /> Copy
                    </button>
                    {['image', 'video', 'file', 'link'].includes(result.qrType) && (
                      <button
                        type="button"
                        onClick={() => onNavigate?.(`/q/${result.shareId}`)}
                        className="font-semibold text-[#111214] dark:text-[#F4F4F0] inline-flex items-center gap-1 cursor-pointer shrink-0 ml-1"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> Open Page
                      </button>
                    )}
                  </div>
                </div>

                {/* PNG Resolution Selector */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">
                    PNG Export Resolution
                  </span>
                  <div className="flex items-center gap-1 p-1 rounded-xl bg-[#F4F1EA] dark:bg-[#0D1015] border border-[#E2DED4] dark:border-[#232833]">
                    {([512, 1024, 2048] as const).map((resVal) => (
                      <button
                        key={resVal}
                        type="button"
                        onClick={() => setDesign((d) => ({ ...d, resolution: resVal }))}
                        className={`px-3 py-1 rounded-lg font-mono text-xs font-semibold cursor-pointer ${
                          design.resolution === resVal
                            ? 'bg-white dark:bg-[#1E222C] text-[#111214] dark:text-[#F4F4F0] shadow-xs'
                            : 'text-[#6B707B]'
                        }`}
                      >
                        {resVal}px
                      </button>
                    ))}
                  </div>
                </div>

                {/* Action Buttons Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => void handleDownloadPng()}
                    className="min-h-[46px] px-4 rounded-2xl bg-gradient-to-b from-[#1A1C22] to-[#0B0D11] dark:from-[#E5C453] dark:to-[#C59D24] text-white dark:text-[#0B0C0E] text-xs font-bold inline-flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download PNG</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadSvg}
                    className="min-h-[46px] px-4 rounded-2xl border border-[#DAD4C7] dark:border-[#2B303C] bg-white dark:bg-[#151820] text-xs font-bold inline-flex items-center justify-center gap-2 hover:border-[#C9A227] cursor-pointer"
                  >
                    <Download className="w-4 h-4 text-[#C9A227]" />
                    <span>Download SVG</span>
                  </button>

                  <button
                    type="button"
                    disabled={pdfDownloading}
                    onClick={() => void handleDownloadPdf()}
                    className="min-h-[46px] px-4 rounded-2xl border border-[#DAD4C7] dark:border-[#2B303C] bg-white dark:bg-[#151820] text-xs font-bold inline-flex items-center justify-center gap-2 hover:border-[#C9A227] cursor-pointer disabled:opacity-60"
                  >
                    {pdfDownloading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <FileText className="w-4 h-4 text-[#C9A227]" />
                    )}
                    <span>Download PDF</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleShare()}
                    className="min-h-[44px] px-4 rounded-2xl border border-[#DAD4C7] dark:border-[#2B303C] text-xs font-semibold inline-flex items-center justify-center gap-2 hover:border-[#C9A227] cursor-pointer"
                  >
                    <Share2 className="w-4 h-4" />
                    <span>Share</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowPrintModal(true)}
                    className="min-h-[44px] px-4 rounded-2xl border border-[#DAD4C7] dark:border-[#2B303C] text-xs font-semibold inline-flex items-center justify-center gap-2 hover:border-[#C9A227] cursor-pointer"
                  >
                    <Printer className="w-4 h-4" />
                    <span>Print</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowCustomize((s) => !s)}
                    className={`min-h-[44px] px-4 rounded-2xl border text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer ${
                      showCustomize
                        ? 'border-[#C9A227] bg-[#C9A227]/12 text-[#9A7410] dark:text-[#D4AF37]'
                        : 'border-[#DAD4C7] dark:border-[#2B303C] hover:border-[#C9A227]'
                    }`}
                  >
                    <Palette className="w-4 h-4" />
                    <span>Customize</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Live Customization Panel */}
            {showCustomize && (
              <div className="pt-6 border-t border-[#EFECE4] dark:border-[#232833] space-y-5">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-[#111214] dark:text-[#F4F4F0]">
                    QR Templates &amp; Style
                  </h4>
                  <button
                    type="button"
                    onClick={() => setDesign(DEFAULT_QR_DESIGN)}
                    className="text-xs font-semibold text-[#B88E1E] dark:text-[#D4AF37] hover:underline cursor-pointer"
                  >
                    Reset Style
                  </button>
                </div>

                {/* Templates */}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {QR_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => applyTemplate(tpl.id)}
                      className={`min-h-[42px] px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                        design.template === tpl.id
                          ? 'border-[#C9A227] bg-[#C9A227]/15 text-[#9A7410] dark:text-[#D4AF37]'
                          : 'border-[#E2DED4] dark:border-[#262B37] hover:border-[#C9A227]'
                      }`}
                    >
                      {tpl.label}
                    </button>
                  ))}
                </div>

                {/* Colors & Styles */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                  <div className="rounded-2xl border border-[#E2DED4] dark:border-[#262B37] p-3.5 space-y-2">
                    <span className="text-xs font-semibold block">QR Color</span>
                    <div className="flex items-center gap-2">
                      {['#0B0C0E', '#B88E1E', '#1E3A8A'].map((col) => (
                        <button
                          key={col}
                          type="button"
                          onClick={() => setDesign((d) => ({ ...d, fgColor: col }))}
                          aria-label={`Color ${col}`}
                          className={`w-7 h-7 rounded-lg border cursor-pointer ${
                            design.fgColor.toLowerCase() === col.toLowerCase()
                              ? 'ring-2 ring-[#C9A227] ring-offset-1'
                              : 'border-[#DAD4C7]'
                          }`}
                          style={{ backgroundColor: col }}
                        />
                      ))}
                      <input
                        type="color"
                        value={design.fgColor}
                        onChange={(e) => setDesign((d) => ({ ...d, fgColor: e.target.value }))}
                        aria-label="Custom QR Color"
                        className="w-8 h-7 rounded cursor-pointer border-0 bg-transparent ml-auto"
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[#E2DED4] dark:border-[#262B37] p-3.5 space-y-2">
                    <span className="text-xs font-semibold block">Background</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setDesign((d) => ({ ...d, bgColor: '#FFFFFF', transparentBg: false }))}
                        className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                          !design.transparentBg && design.bgColor === '#FFFFFF'
                            ? 'border-[#C9A227] bg-[#C9A227]/12'
                            : 'border-[#DAD4C7] dark:border-[#2B303C]'
                        }`}
                      >
                        White
                      </button>
                      <button
                        type="button"
                        onClick={() => setDesign((d) => ({ ...d, transparentBg: !d.transparentBg }))}
                        className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                          design.transparentBg
                            ? 'border-[#C9A227] bg-[#C9A227]/12'
                            : 'border-[#DAD4C7] dark:border-[#2B303C]'
                        }`}
                      >
                        Transparent
                      </button>
                      <input
                        type="color"
                        value={design.bgColor}
                        onChange={(e) =>
                          setDesign((d) => ({ ...d, bgColor: e.target.value, transparentBg: false }))
                        }
                        aria-label="Custom Background Color"
                        className="w-8 h-7 rounded cursor-pointer border-0 bg-transparent ml-auto"
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[#E2DED4] dark:border-[#262B37] p-3.5 space-y-2">
                    <span className="text-xs font-semibold block">Dots &amp; Corners</span>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setDesign((d) => ({
                            ...d,
                            moduleStyle: d.moduleStyle === 'square' ? 'rounded' : 'square',
                          }))
                        }
                        className="px-2.5 py-1.5 rounded-lg border border-[#DAD4C7] dark:border-[#2B303C] text-[11px] font-semibold cursor-pointer"
                      >
                        Dots: {design.moduleStyle}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDesign((d) => ({
                            ...d,
                            eyeStyle: d.eyeStyle === 'square' ? 'rounded' : 'square',
                          }))
                        }
                        className="px-2.5 py-1.5 rounded-lg border border-[#DAD4C7] dark:border-[#2B303C] text-[11px] font-semibold cursor-pointer"
                      >
                        Eyes: {design.eyeStyle}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[#E2DED4] dark:border-[#262B37] p-3.5 space-y-2">
                    <span className="text-xs font-semibold block">Center Logo</span>
                    <div className="grid grid-cols-4 gap-1">
                      {(['none', 'rikzen', 'photo', 'video'] as const).map((lm) => (
                        <button
                          key={lm}
                          type="button"
                          onClick={() => setDesign((d) => ({ ...d, logoMode: lm }))}
                          className={`py-1.5 rounded-lg border text-[11px] font-semibold capitalize cursor-pointer ${
                            design.logoMode === lm
                              ? 'border-[#C9A227] bg-[#C9A227]/15 text-[#9A7410] dark:text-[#D4AF37]'
                              : 'border-[#DAD4C7] dark:border-[#2B303C]'
                          }`}
                        >
                          {lm}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Recent QR History Strip */}
      {localHistory.length > 0 && (
        <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#111214] dark:text-[#F4F4F0]">
              Recent QR History
            </h3>
            {user && (
              <button
                type="button"
                onClick={() => onNavigate?.('/qr-codes')}
                className="text-xs font-semibold text-[#B88E1E] dark:text-[#D4AF37] hover:underline cursor-pointer"
              >
                Manage All in My QR Codes →
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {localHistory.slice(0, 6).map((item) => (
              <div
                key={item.shareId}
                className="rounded-2xl border border-[#EFECE4] dark:border-[#232833] bg-[#FAF8F4] dark:bg-[#0D1015] p-3.5 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold uppercase text-[#B88E1E] dark:text-[#D4AF37]">
                    {item.qrType} QR
                  </div>
                  <div className="text-sm font-bold text-[#111214] dark:text-[#F4F4F0] truncate">
                    {item.name}
                  </div>
                  <div className="text-[11px] text-[#6B707B] truncate font-mono">
                    {['image', 'video', 'file'].includes(item.qrType) ? item.shareUrl : item.payload}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    title="Open"
                    onClick={() => {
                      setResult(item);
                      setDesign(item.design || DEFAULT_QR_DESIGN);
                      setPhase('result');
                    }}
                    className="min-h-[34px] min-w-[34px] rounded-xl border border-[#DAD4C7] dark:border-[#2B303C] bg-white dark:bg-[#151820] flex items-center justify-center cursor-pointer hover:border-[#C9A227]"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Copy Link"
                    onClick={async () => {
                      const val = ['image', 'video', 'file'].includes(item.qrType)
                        ? item.shareUrl
                        : item.payload;
                      await navigator.clipboard?.writeText(val);
                      notify('Copied.', 'success');
                    }}
                    className="min-h-[34px] min-w-[34px] rounded-xl border border-[#DAD4C7] dark:border-[#2B303C] bg-white dark:bg-[#151820] flex items-center justify-center cursor-pointer hover:border-[#C9A227]"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Delete"
                    onClick={() => {
                      saveLocalHistory(localHistory.filter((x) => x.shareId !== item.shareId));
                    }}
                    className="min-h-[34px] min-w-[34px] rounded-xl border border-[#DAD4C7] dark:border-[#2B303C] bg-white dark:bg-[#151820] flex items-center justify-center text-red-500 cursor-pointer hover:border-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Printable QR Sheet Modal (No blocked window.open popups) */}
      {showPrintModal && result && renderedQr && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowPrintModal(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-white text-[#111214] p-7 space-y-5 shadow-2xl text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between print:hidden">
              <span className="text-xs font-bold uppercase tracking-wider text-[#B88E1E]">
                Print Preview
              </span>
              <button
                type="button"
                onClick={() => setShowPrintModal(false)}
                className="min-h-[34px] min-w-[34px] rounded-xl border border-[#E5E5E0] flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="border border-[#E5E5E0] rounded-3xl p-6 space-y-3 bg-white">
              <p className="text-[11px] font-bold tracking-widest uppercase text-[#B88E1E]">
                RIKZEN ALL-IN-ONE TOOLS
              </p>
              <h3 className="text-xl font-extrabold text-[#111214]">{result.name}</h3>
              <img src={renderedQr.dataUrl} alt={result.name} className="w-60 h-60 mx-auto" />
              <p className="text-xs text-[#6B707B]">Scan with any phone camera</p>
            </div>

            <div className="flex gap-2.5 print:hidden">
              <button
                type="button"
                onClick={() => window.print()}
                className="flex-1 min-h-[46px] rounded-2xl bg-[#111214] text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Print Now</span>
              </button>
              <button
                type="button"
                onClick={() => void handleDownloadPdf()}
                className="min-h-[46px] px-4 rounded-2xl border border-[#DAD4C7] text-xs font-bold cursor-pointer"
              >
                Save PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
