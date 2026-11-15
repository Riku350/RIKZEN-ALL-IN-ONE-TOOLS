import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import {
  CATEGORIES,
  searchTools,
  ToolCategory,
} from '../lib/toolRegistry';
import { ToolCard } from '../components/ToolCard';
import { useApp } from '../contexts/AppContext';

interface ToolsCatalogPageProps {
  initialCategory?: string | null;
  onNavigate: (path: string) => void;
  onOpenAuthModal: () => void;
}

export const ToolsCatalogPage: React.FC<ToolsCatalogPageProps> = ({
  initialCategory,
  onNavigate,
  onOpenAuthModal,
}) => {
  const { t } = useApp();
  const [category, setCategory] = useState<ToolCategory | 'all'>(() => {
    if (
      initialCategory === 'image' ||
      initialCategory === 'pdf' ||
      initialCategory === 'document' ||
      initialCategory === 'student' ||
      initialCategory === 'utility'
    ) {
      return initialCategory;
    }
    return 'all';
  });
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (
      initialCategory === 'image' ||
      initialCategory === 'pdf' ||
      initialCategory === 'document' ||
      initialCategory === 'student' ||
      initialCategory === 'utility'
    ) {
      setCategory(initialCategory);
    } else if (initialCategory === null) {
      setCategory('all');
    }
  }, [initialCategory]);

  const filtered = useMemo(() => searchTools(query, category), [query, category]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-7 pb-24 md:pb-16">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#111214] dark:text-[#F4F4F0]">
            All Tools
          </h1>
          <p className="text-sm text-[#5A5D65] dark:text-[#9CA0AA] mt-1">
            {filtered.length} tools ready to use
          </p>
        </div>

        <div className="w-full md:w-80 flex items-center gap-2.5 rounded-2xl border border-[#DADAD4] dark:border-[#282C36] bg-white dark:bg-[#13151A] px-4 min-h-[46px] focus-within:border-[#C9A227]">
          <Search className="w-4 h-4 text-[#C9A227] shrink-0" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="w-full bg-transparent text-sm focus:outline-none"
          />
        </div>
      </div>

      {/* Interactive segmented category filter */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setCategory('all')}
          className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
            category === 'all'
              ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] border-transparent'
              : 'border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] text-[#5A5D65] dark:text-[#9CA0AA] hover:border-[#C9A227]'
          }`}
        >
          All Categories
        </button>
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setCategory(cat.id)}
            className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
              category === cat.id
                ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] border-transparent'
                : 'border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] text-[#5A5D65] dark:text-[#9CA0AA] hover:border-[#C9A227]'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-12 text-center space-y-3">
          <p className="text-base font-bold">No tools found</p>
          <p className="text-sm text-[#5A5D65] dark:text-[#9CA0AA]">
            Try clearing your search filter or browsing another category.
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setCategory('all');
            }}
            className="min-h-[42px] px-5 rounded-xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-xs font-semibold cursor-pointer"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((tool) => (
            <ToolCard
              key={tool.id}
              tool={tool}
              onOpen={onNavigate}
              onRequireAuth={onOpenAuthModal}
            />
          ))}
        </div>
      )}
    </div>
  );
};
