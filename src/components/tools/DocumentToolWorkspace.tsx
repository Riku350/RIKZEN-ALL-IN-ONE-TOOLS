import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ToolDefinition } from '../../lib/toolRegistry';
import { SelectedUploadItem, UploadZone } from '../UploadZone';
import { ProcessedResult, ToolResultCard } from './ToolResultCard';
import { useAuth } from '../../contexts/AuthContext';
import { useApp } from '../../contexts/AppContext';
import { trackAnalyticsEvent } from '../../lib/formatters';

export const DocumentToolWorkspace: React.FC<{ tool: ToolDefinition }> = ({ tool }) => {
  const { getToken } = useAuth();
  const { t, toolConfigs } = useApp();

  const [files, setFiles] = useState<SelectedUploadItem[]>([]);
  const [textContent, setTextContent] = useState('');
  const [targetFormat, setTargetFormat] = useState('pdf');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProcessedResult | null>(null);

  const maxSizeMb = toolConfigs[tool.id]?.maxFileSizeMb || tool.maxSizeMb;

  useEffect(() => {
    setFiles([]);
    setTextContent('');
    setTargetFormat('pdf');
    setResult(null);
    setError(null);
  }, [tool.id]);

  const handleConvert = async () => {
    if (files.length === 0 && !textContent.trim()) return;
    setProcessing(true);
    setError(null);
    void trackAnalyticsEvent('processing_started', tool.id, tool.category);

    try {
      const token = await getToken();
      const form = new FormData();
      form.append('toolId', tool.id);
      form.append('toolName', tool.name);
      form.append('targetFormat', targetFormat);
      if (files[0]) {
        form.append('file', files[0].file);
      }
      if (textContent.trim()) {
        form.append('textContent', textContent);
      }

      const res = await fetch('/api/tools/document/convert', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not convert this document.');

      setResult({
        fileName: data.fileName,
        mimeType: data.mimeType,
        originalSizeBytes: data.originalSizeBytes,
        outputSizeBytes: data.outputSizeBytes,
        downloadUrl: data.downloadUrl,
      });
    } catch (err) {
      setError(
        err instanceof TypeError
          ? 'Connection problem. Please retry.'
          : err instanceof Error
          ? err.message
          : 'Something went wrong. Please try again.'
      );
    } finally {
      setProcessing(false);
    }
  };

  if (result) {
    return (
      <ToolResultCard
        result={result}
        onDownloadClick={() => void trackAnalyticsEvent('download_clicked', tool.id, tool.category)}
        onReset={() => {
          setFiles([]);
          setTextContent('');
          setResult(null);
          setError(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <UploadZone
        accept={tool.acceptAttr}
        supportedFormats={tool.supportedFormats}
        maxSizeMb={maxSizeMb}
        files={files}
        onFilesSelected={(items) => {
          setFiles(items);
          setError(null);
          void trackAnalyticsEvent('file_uploaded', tool.id, tool.category);
        }}
        onRemoveFile={() => setFiles([])}
      />

      {tool.id === 'text-to-pdf' && files.length === 0 && (
        <div className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-5 space-y-2">
          <label className="text-sm font-semibold text-[#111214] dark:text-[#F4F4F0] block">
            Or paste text directly
          </label>
          <textarea
            rows={6}
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            placeholder="Write or paste your notes here to turn them into a clean PDF..."
            className="w-full rounded-2xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] p-4 text-sm focus:outline-none focus:border-[#C9A227]"
          />
        </div>
      )}

      {(files.length > 0 || textContent.trim().length > 0) && (
        <div className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-6 space-y-4">
          {tool.id === 'document-converter' && (
            <div className="space-y-2">
              <span className="text-sm font-semibold text-[#111214] dark:text-[#F4F4F0] block">
                Convert To
              </span>
              <div className="flex flex-wrap gap-2">
                {['pdf', 'txt', 'html', 'csv', 'json'].map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setTargetFormat(fmt)}
                    className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold uppercase border transition-colors cursor-pointer ${
                      targetFormat === fmt
                        ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] border-transparent'
                        : 'border-[#DADAD4] dark:border-[#2C303A] text-[#5A5D65] dark:text-[#9CA0AA]'
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
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
            onClick={() => void handleConvert()}
            className="w-full min-h-[50px] rounded-2xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] px-6 py-3.5 text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-70 cursor-pointer"
          >
            {processing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{t.processing}</span>
              </>
            ) : (
              <span>Convert to {targetFormat.toUpperCase()}</span>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
