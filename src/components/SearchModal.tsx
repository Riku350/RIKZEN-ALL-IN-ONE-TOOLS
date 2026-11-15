import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import { searchTools, TOOL_REGISTRY } from '../lib/toolRegistry';
import { ToolIcon } from './ToolIcon';

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
  onSelectTool: (route: string) => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({ open, onClose, onSelectTool }) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (open) onClose();
      }
      if (e.key === 'Escape' && open) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const results = useMemo(() => {
    if (!query.trim()) {
      return TOOL_REGISTRY.filter((t) => t.popular).slice(0, 8);
    }
    return searchTools(query).slice(0, 12);
  }, [query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm p-4 pt-16 sm:pt-24"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-3xl border border-[#E5E5E0] dark:border-[#252832] bg-white dark:bg-[#13151A] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Search RIKZEN tools"
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[#E5E5E0] dark:border-[#22252C]">
          <Search className="w-5 h-5 text-[#C9A227] shrink-0" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tools... (e.g. compress, photo, pdf, qr)"
            className="w-full bg-transparent text-base text-[#111214] dark:text-[#F4F4F0] placeholder:text-[#8E939E] focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="min-h-[36px] min-w-[36px] rounded-xl flex items-center justify-center text-[#6B707B] hover:text-[#111214] dark:hover:text-[#F4F4F0] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="py-12 text-center text-sm text-[#6B707B] dark:text-[#9CA0AA]">
              No tools match "{query}". Try "compress", "pdf", "photo", or "qr".
            </div>
          ) : (
            <div className="divide-y divide-[#F0F0EC] dark:divide-[#1E2128]">
              {results.map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => {
                    onSelectTool(tool.route);
                    onClose();
                  }}
                  className="w-full min-h-[56px] px-4 py-3 flex items-center justify-between gap-3 rounded-2xl hover:bg-[#F5F5F1] dark:hover:bg-[#1A1D24] transition-colors text-left cursor-pointer"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <span className="w-10 h-10 rounded-xl bg-[#F4F2EC] dark:bg-[#1E2027] text-[#111214] dark:text-[#D4AF37] flex items-center justify-center shrink-0">
                      <ToolIcon name={tool.icon} className="w-5 h-5" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[#111214] dark:text-[#F4F4F0] truncate">
                        {tool.name}
                      </div>
                      <div className="text-xs text-[#6B707B] dark:text-[#9CA0AA] truncate">
                        {tool.supportedFormats.join(' / ')} · {tool.description}
                      </div>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[#8E939E] shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
