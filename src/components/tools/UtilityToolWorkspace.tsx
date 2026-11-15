import React, { useEffect, useMemo, useRef, useState } from 'react';
import jsQR from 'jsqr';
import JsBarcode from 'jsbarcode';
import {
  Camera,
  Check,
  Copy,
  Download,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
  StopCircle,
  Upload,
} from 'lucide-react';
import { ToolDefinition } from '../../lib/toolRegistry';
import { useApp } from '../../contexts/AppContext';
import { logClientToolExecution } from '../../lib/formatters';
import { triggerBlobSave } from '../../lib/downloadClient';
import { QrStudioWorkspace } from './QrStudioWorkspace';

export const UtilityToolWorkspace: React.FC<{
  tool: ToolDefinition;
  onNavigate?: (path: string) => void;
}> = ({ tool, onNavigate }) => {
  switch (tool.id) {
    case 'qr-generator':
      return <QrStudioWorkspace tool={tool} onNavigate={onNavigate} />;
    case 'qr-scanner':
      return <QrScannerTool tool={tool} />;
    case 'barcode-generator':
      return <BarcodeTool tool={tool} />;
    case 'password-generator':
      return <PasswordGeneratorTool tool={tool} />;
    case 'random-number-generator':
      return <RandomNumberTool tool={tool} />;
    case 'text-counter':
      return <TextCounterTool tool={tool} />;
    case 'case-converter':
      return <CaseConverterTool tool={tool} />;
    case 'json-formatter':
      return <JsonFormatterTool tool={tool} />;
    case 'url-encoder-decoder':
    default:
      return <UrlEncoderTool tool={tool} />;
  }
};

const QrScannerTool: React.FC<{ tool: ToolDefinition }> = ({ tool }) => {
  const { notify } = useApp();
  const [scanned, setScanned] = useState<string | null>(null);
  const [scanningCam, setScanningCam] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    setScanningCam(false);
  };

  useEffect(() => () => stopCamera(), []);

  const startCamera = async () => {
    setCamError(null);
    setScanned(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setScanningCam(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      }, 60);
    } catch {
      setCamError('Camera access was denied or unavailable. You can upload a QR image instead.');
    }
  };

  useEffect(() => {
    if (!scanningCam) return;
    let rafId = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const tick = () => {
      const video = videoRef.current;
      if (video && video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imgData.data, imgData.width, imgData.height);
        if (code?.data) {
          setScanned(code.data);
          stopCamera();
          void logClientToolExecution({
            toolId: tool.id,
            toolName: tool.name,
            category: tool.category,
            fileName: 'Camera QR Scan',
          });
          return;
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [scanningCam, tool]);

  const handleImageUpload = (file: File) => {
    setCamError(null);
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imgData.data, imgData.width, imgData.height);
        if (code?.data) {
          setScanned(code.data);
          void logClientToolExecution({
            toolId: tool.id,
            toolName: tool.name,
            category: tool.category,
            fileName: file.name,
            inputSizeBytes: file.size,
          });
        } else {
          setCamError('No QR code could be detected in that image. Try a clearer photo.');
        }
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  return (
    <div className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-6 space-y-5">
      <div className="flex flex-wrap gap-3">
        {!scanningCam ? (
          <button
            type="button"
            onClick={() => void startCamera()}
            className="min-h-[46px] px-5 rounded-2xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
          >
            <Camera className="w-4 h-4" />
            <span>Scan with Camera</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={stopCamera}
            className="min-h-[46px] px-5 rounded-2xl bg-red-600 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
          >
            <StopCircle className="w-4 h-4" />
            <span>Stop Camera</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="min-h-[46px] px-5 rounded-2xl border border-[#DADAD4] dark:border-[#2C303A] text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
        >
          <Upload className="w-4 h-4" />
          <span>Upload QR Image</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => {
            if (e.target.files?.[0]) handleImageUpload(e.target.files[0]);
            e.target.value = '';
          }}
          className="hidden"
        />
      </div>

      {scanningCam && (
        <div className="rounded-2xl overflow-hidden bg-black aspect-video max-h-80">
          <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
        </div>
      )}

      {camError && (
        <div className="rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          {camError}
        </div>
      )}

      {scanned && (() => {
        const isSafeUrl = /^https?:\/\//i.test(scanned.trim());
        const isSuspiciousScheme = /^(javascript|data|vbscript):/i.test(scanned.trim());
        return (
          <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                Decoded QR Value
              </span>
              {isSuspiciousScheme && (
                <span className="text-[11px] font-bold text-red-600 dark:text-red-400 inline-flex items-center gap-1">
                  <ShieldAlert className="w-3.5 h-3.5" /> Unsafe script scheme blocked
                </span>
              )}
            </div>
            <p className="text-sm font-mono break-all text-[#111214] dark:text-[#F4F4F0]">{scanned}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard?.writeText(scanned);
                  notify('Copied to clipboard.', 'success');
                }}
                className="min-h-[40px] px-4 rounded-xl bg-white dark:bg-[#191C23] border border-[#DADAD4] dark:border-[#2C303A] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" /> Copy Value
              </button>
              {isSafeUrl && (
                <a
                  href={scanned.trim()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[40px] px-4 rounded-xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Open Destination
                </a>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
};

const BarcodeTool: React.FC<{ tool: ToolDefinition }> = ({ tool }) => {
  const [value, setValue] = useState('RIKZEN-2026');
  const [format, setFormat] = useState('CODE128');
  const [error, setError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    try {
      JsBarcode(svgRef.current, value || ' ', {
        format,
        lineColor: '#0B0C0E',
        background: '#FFFFFF',
        width: 2,
        height: 90,
        displayValue: true,
      });
      setError(null);
    } catch {
      setError(`Value does not match ${format} format rules.`);
    }
  }, [value, format]);

  const downloadSvg = () => {
    if (!svgRef.current || error) return;
    const xml = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([xml], { type: 'image/svg+xml' });
    triggerBlobSave(blob, `rikzen-barcode-${format.toLowerCase()}.svg`);
    void logClientToolExecution({
      toolId: tool.id,
      toolName: tool.name,
      category: tool.category,
      fileName: `barcode-${format}.svg`,
    });
  };

  return (
    <div className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-6 space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">Barcode Data</span>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full min-h-[44px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-3.5 text-sm font-mono"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">Symbology</span>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            className="w-full min-h-[44px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-3.5 text-sm"
          >
            <option value="CODE128">CODE128 (Any ASCII)</option>
            <option value="EAN13">EAN-13 (12 or 13 digits)</option>
            <option value="UPC">UPC (11 or 12 digits)</option>
            <option value="CODE39">CODE39 (Alphanumeric)</option>
          </select>
        </label>
      </div>

      {error && <p className="text-xs text-amber-600">{error}</p>}

      <div className="rounded-2xl bg-white p-6 border border-[#E5E5E0] flex justify-center overflow-x-auto">
        <svg ref={svgRef} />
      </div>

      <button
        type="button"
        disabled={Boolean(error)}
        onClick={downloadSvg}
        className="min-h-[46px] px-6 rounded-2xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50 cursor-pointer"
      >
        <Download className="w-4 h-4" />
        <span>Download SVG</span>
      </button>
    </div>
  );
};

const PasswordGeneratorTool: React.FC<{ tool: ToolDefinition }> = ({ tool }) => {
  const { notify } = useApp();
  const [length, setLength] = useState(16);
  const [upper, setUpper] = useState(true);
  const [lower, setLower] = useState(true);
  const [numbers, setNumbers] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const [password, setPassword] = useState('');

  const generate = () => {
    let charset = '';
    if (upper) charset += 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    if (lower) charset += 'abcdefghijkmnopqrstuvwxyz';
    if (numbers) charset += '23456789';
    if (symbols) charset += '!@#$%^&*()-_=+[]{}';
    if (!charset) charset = 'abcdefghijkmnopqrstuvwxyz23456789';

    const arr = new Uint32Array(length);
    crypto.getRandomValues(arr);
    let out = '';
    for (let i = 0; i < length; i++) {
      out += charset[arr[i] % charset.length];
    }
    setPassword(out);
    void logClientToolExecution({
      toolId: tool.id,
      toolName: tool.name,
      category: tool.category,
      fileName: `${length}-char password`,
    });
  };

  useEffect(() => {
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [length, upper, lower, numbers, symbols]);

  return (
    <div className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-6 space-y-5">
      <div className="rounded-2xl bg-[#FAFAF8] dark:bg-[#0B0C0E] border border-[#E5E5E0] dark:border-[#242832] p-4 flex items-center justify-between gap-3">
        <span className="font-mono text-base sm:text-lg font-bold break-all">{password}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={generate}
            aria-label="Regenerate password"
            className="min-h-[40px] min-w-[40px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] flex items-center justify-center cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard?.writeText(password);
              notify('Password copied.', 'success');
            }}
            className="min-h-[40px] px-4 rounded-xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" /> Copy
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-xs font-semibold">
          <span>Length</span>
          <span className="font-mono tabular-nums text-[#C9A227]">{length} characters</span>
        </div>
        <input type="range" min={8} max={64} value={length} onChange={(e) => setLength(Number(e.target.value))} className="w-full accent-[#C9A227]" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-semibold">
        {[
          { label: 'Uppercase (A-Z)', state: upper, set: setUpper },
          { label: 'Lowercase (a-z)', state: lower, set: setLower },
          { label: 'Numbers (0-9)', state: numbers, set: setNumbers },
          { label: 'Symbols (!@#)', state: symbols, set: setSymbols },
        ].map((opt) => (
          <label key={opt.label} className="flex items-center gap-2 rounded-xl border border-[#E5E5E0] dark:border-[#242832] px-3 py-2.5 cursor-pointer">
            <input type="checkbox" checked={opt.state} onChange={(e) => opt.set(e.target.checked)} className="accent-[#C9A227] w-4 h-4" />
            <span>{opt.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
};

const RandomNumberTool: React.FC<{ tool: ToolDefinition }> = ({ tool }) => {
  const [min, setMin] = useState('1');
  const [max, setMax] = useState('100');
  const [count, setCount] = useState('1');
  const [results, setResults] = useState<number[]>([42]);

  const roll = () => {
    const lo = Math.ceil(Number(min) || 0);
    const hi = Math.floor(Number(max) || 100);
    const low = Math.min(lo, hi);
    const high = Math.max(lo, hi);
    const qty = Math.min(50, Math.max(1, Number(count) || 1));
    const arr = new Uint32Array(qty);
    crypto.getRandomValues(arr);
    const nums = Array.from(arr).map((r) => low + (r % (high - low + 1)));
    setResults(nums);
    void logClientToolExecution({
      toolId: tool.id,
      toolName: tool.name,
      category: tool.category,
      fileName: `Range ${low}-${high}`,
    });
  };

  return (
    <div className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-6 space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <label className="text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">
          Min
          <input type="number" value={min} onChange={(e) => setMin(e.target.value)} className="mt-1 w-full min-h-[44px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-3 text-sm font-mono tabular-nums" />
        </label>
        <label className="text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">
          Max
          <input type="number" value={max} onChange={(e) => setMax(e.target.value)} className="mt-1 w-full min-h-[44px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-3 text-sm font-mono tabular-nums" />
        </label>
        <label className="text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">
          Quantity
          <input type="number" min={1} max={50} value={count} onChange={(e) => setCount(e.target.value)} className="mt-1 w-full min-h-[44px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-3 text-sm font-mono tabular-nums" />
        </label>
      </div>

      <button
        type="button"
        onClick={roll}
        className="w-full min-h-[48px] rounded-2xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-sm font-semibold cursor-pointer"
      >
        Generate Number
      </button>

      <div className="rounded-2xl bg-[#FAFAF8] dark:bg-[#0F1116] border border-[#E5E5E0] dark:border-[#242832] p-5 flex flex-wrap gap-3 justify-center">
        {results.map((n, i) => (
          <span key={i} className="text-3xl font-bold font-mono tabular-nums text-[#C9A227]">
            {n}{i < results.length - 1 ? ',' : ''}
          </span>
        ))}
      </div>
    </div>
  );
};

const TextCounterTool: React.FC<{ tool: ToolDefinition }> = ({ tool }) => {
  const [text, setText] = useState('');
  const stats = useMemo(() => {
    const trimmed = text.trim();
    const words = trimmed ? trimmed.split(/\s+/).length : 0;
    const chars = text.length;
    const charsNoSpaces = text.replace(/\s/g, '').length;
    const sentences = trimmed ? trimmed.split(/[.!?]+/).filter((s) => s.trim()).length : 0;
    const paragraphs = trimmed ? trimmed.split(/\n\s*\n/).filter((p) => p.trim()).length : 0;
    const readMin = Math.max(words > 0 ? 1 : 0, Math.ceil(words / 200));
    return { words, chars, charsNoSpaces, sentences, paragraphs, readMin };
  }, [text]);

  useEffect(() => {
    if (text.length > 0) {
      void logClientToolExecution({
        toolId: tool.id,
        toolName: tool.name,
        category: tool.category,
        fileName: `${stats.words} words`,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-6 space-y-5">
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-center">
        {[
          { label: 'Words', val: stats.words },
          { label: 'Characters', val: stats.chars },
          { label: 'No Spaces', val: stats.charsNoSpaces },
          { label: 'Sentences', val: stats.sentences },
          { label: 'Paragraphs', val: stats.paragraphs },
          { label: 'Read (min)', val: stats.readMin },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl bg-[#FAFAF8] dark:bg-[#0F1116] p-3 border border-[#E5E5E0] dark:border-[#242832]">
            <div className="text-xl font-bold font-mono tabular-nums text-[#C9A227]">{item.val}</div>
            <div className="text-[11px] text-[#6B707B] mt-0.5">{item.label}</div>
          </div>
        ))}
      </div>

      <textarea
        rows={8}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste or start typing your text here..."
        className="w-full rounded-2xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] p-4 text-sm focus:outline-none focus:border-[#C9A227]"
      />
    </div>
  );
};

const CaseConverterTool: React.FC<{ tool: ToolDefinition }> = ({ tool }) => {
  const { notify } = useApp();
  const [text, setText] = useState('Everything you need. One simple place.');

  const apply = (mode: string) => {
    let next = text;
    if (mode === 'upper') next = text.toUpperCase();
    else if (mode === 'lower') next = text.toLowerCase();
    else if (mode === 'title') {
      next = text.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    } else if (mode === 'sentence') {
      next = text.toLowerCase().replace(/(^\s*\w|[.!?]\s+\w)/g, (c) => c.toUpperCase());
    } else if (mode === 'camel') {
      next = text
        .toLowerCase()
        .replace(/[^a-zA-Z0-9]+(.)/g, (_m, chr) => chr.toUpperCase());
    }
    setText(next);
    void logClientToolExecution({
      toolId: tool.id,
      toolName: tool.name,
      category: tool.category,
      fileName: `Case: ${mode}`,
    });
  };

  return (
    <div className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-6 space-y-4">
      <textarea
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded-2xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] p-4 text-sm focus:outline-none focus:border-[#C9A227]"
      />
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'upper', label: 'UPPERCASE' },
          { id: 'lower', label: 'lowercase' },
          { id: 'title', label: 'Title Case' },
          { id: 'sentence', label: 'Sentence case' },
          { id: 'camel', label: 'camelCase' },
        ].map((btn) => (
          <button
            key={btn.id}
            type="button"
            onClick={() => apply(btn.id)}
            className="min-h-[42px] px-4 rounded-xl border border-[#DADAD4] dark:border-[#2C303A] text-xs font-semibold hover:border-[#C9A227] cursor-pointer"
          >
            {btn.label}
          </button>
        ))}
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard?.writeText(text);
            notify('Converted text copied.', 'success');
          }}
          className="min-h-[42px] px-4 rounded-xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-xs font-semibold inline-flex items-center gap-1.5 ml-auto cursor-pointer"
        >
          <Copy className="w-3.5 h-3.5" /> Copy
        </button>
      </div>
    </div>
  );
};

const JsonFormatterTool: React.FC<{ tool: ToolDefinition }> = ({ tool }) => {
  const { notify } = useApp();
  const [input, setInput] = useState('{"brand":"RIKZEN","tools":47,"fast":true}');
  const [status, setStatus] = useState<{ ok: boolean; msg: string }>({ ok: true, msg: 'Valid JSON' });

  const format = (spaces: number) => {
    try {
      const parsed = JSON.parse(input);
      setInput(JSON.stringify(parsed, null, spaces));
      setStatus({ ok: true, msg: spaces === 0 ? 'Valid JSON (Minified)' : 'Valid JSON (Formatted)' });
      void logClientToolExecution({
        toolId: tool.id,
        toolName: tool.name,
        category: tool.category,
        fileName: 'formatted.json',
      });
    } catch (err) {
      setStatus({ ok: false, msg: err instanceof Error ? err.message : 'Invalid JSON syntax' });
    }
  };

  return (
    <div className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`text-xs font-semibold inline-flex items-center gap-1.5 ${status.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
          {status.ok && <Check className="w-3.5 h-3.5" />}
          {status.msg}
        </span>
        <div className="flex gap-2">
          <button type="button" onClick={() => format(2)} className="min-h-[40px] px-4 rounded-xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-xs font-semibold cursor-pointer">
            Format
          </button>
          <button type="button" onClick={() => format(0)} className="min-h-[40px] px-4 rounded-xl border border-[#DADAD4] dark:border-[#2C303A] text-xs font-semibold cursor-pointer">
            Minify
          </button>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard?.writeText(input);
              notify('JSON copied.', 'success');
            }}
            className="min-h-[40px] px-3.5 rounded-xl border border-[#DADAD4] dark:border-[#2C303A] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" /> Copy
          </button>
        </div>
      </div>

      <textarea
        rows={10}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        className="w-full rounded-2xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] p-4 text-xs font-mono focus:outline-none focus:border-[#C9A227]"
      />
    </div>
  );
};

const UrlEncoderTool: React.FC<{ tool: ToolDefinition }> = ({ tool }) => {
  const { notify } = useApp();
  const [input, setInput] = useState('https://rikzen.tools/search?q=compress image & pdf');
  const [output, setOutput] = useState('');

  const run = (mode: 'encode' | 'decode') => {
    try {
      setOutput(mode === 'encode' ? encodeURIComponent(input) : decodeURIComponent(input));
      void logClientToolExecution({
        toolId: tool.id,
        toolName: tool.name,
        category: tool.category,
        fileName: `URL ${mode}`,
      });
    } catch {
      notify('Could not decode malformed URL string.', 'error');
    }
  };

  return (
    <div className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-6 space-y-4">
      <textarea
        rows={4}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Enter URL or encoded string..."
        className="w-full rounded-2xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] p-4 text-sm font-mono focus:outline-none focus:border-[#C9A227]"
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => run('encode')} className="min-h-[44px] px-5 rounded-xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-xs font-semibold cursor-pointer">
          Encode URL
        </button>
        <button type="button" onClick={() => run('decode')} className="min-h-[44px] px-5 rounded-xl border border-[#DADAD4] dark:border-[#2C303A] text-xs font-semibold cursor-pointer">
          Decode URL
        </button>
      </div>
      {output && (
        <div className="rounded-2xl bg-[#FAFAF8] dark:bg-[#0F1116] border border-[#E5E5E0] dark:border-[#242832] p-4 flex items-start justify-between gap-3">
          <p className="text-xs font-mono break-all">{output}</p>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard?.writeText(output);
              notify('Copied to clipboard.', 'success');
            }}
            className="min-h-[36px] px-3 rounded-xl border border-[#DADAD4] dark:border-[#2C303A] text-xs font-semibold shrink-0 cursor-pointer"
          >
            Copy
          </button>
        </div>
      )}
    </div>
  );
};
