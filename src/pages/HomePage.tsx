import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Clock,
  Lock,
  Megaphone,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Zap,
} from 'lucide-react';
import {
  CATEGORIES,
  findToolById,
  searchTools,
  TOOL_REGISTRY,
  ToolCategory,
  ToolDefinition,
} from '../lib/toolRegistry';
import { CATEGORY_ICON_STYLES, CATEGORY_STATIC_ICON_STYLES } from '../lib/categoryStyles';
import { useApp } from '../contexts/AppContext';
import { useAuth } from '../contexts/AuthContext';
import { ToolIcon } from '../components/ToolIcon';
import { ToolCard } from '../components/ToolCard';
import { formatRelativeDate } from '../lib/formatters';

interface HomePageProps {
  onNavigate: (path: string) => void;
  onOpenAuthModal: () => void;
}

const QUICK_TOOL_IDS = [
  'compress-image',
  'qr-generator',
  'pdf-to-images',
  'jpg-to-pdf',
  'merge-pdf',
  'background-removal',
  'passport-photo',
  'compress-pdf',
];

export const HomePage: React.FC<HomePageProps> = ({ onNavigate, onOpenAuthModal }) => {
  const { t, announcements, capabilities } = useApp();
  const { user, favorites, history } = useAuth();
  const [heroQuery, setHeroQuery] = useState('');

  const quickTools = useMemo(
    () =>
      QUICK_TOOL_IDS.map((id) => findToolById(id)).filter((item): item is ToolDefinition =>
        Boolean(item)
      ),
    []
  );

  const popularTools = useMemo(
    () => TOOL_REGISTRY.filter((tool) => tool.popular && !QUICK_TOOL_IDS.includes(tool.id)).slice(0, 4),
    []
  );

  const favoriteTools = useMemo(
    () =>
      favorites
        .map((id) => findToolById(id))
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    [favorites]
  );

  const liveSearchResults = useMemo(() => {
    if (!heroQuery.trim()) return [];
    return searchTools(heroQuery).slice(0, 8);
  }, [heroQuery]);

  const recentTools = useMemo(() => {
    const seen = new Set<string>();
    const list = [];
    for (const item of history) {
      if (!seen.has(item.toolId)) {
        seen.add(item.toolId);
        const def = findToolById(item.toolId);
        if (def) list.push({ tool: def, entry: item });
      }
      if (list.length >= 4) break;
    }
    return list;
  }, [history]);

  const countByCategory = (cat: ToolCategory) =>
    TOOL_REGISTRY.filter((item) => item.category === cat).length;

  return (
    <div className="space-y-12 sm:space-y-16 pb-20">
      {/* Announcements */}
      {announcements.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4">
          {announcements.slice(0, 1).map((ann) => (
            <div
              key={ann.id}
              className="rounded-2xl border border-[#C9A227]/35 bg-[#C9A227]/10 dark:bg-[#D4AF37]/10 px-4 py-3 flex items-center gap-3 text-sm"
            >
              <Megaphone className="w-4 h-4 text-[#B88E1E] dark:text-[#D4AF37] shrink-0" />
              <div className="min-w-0">
                <span className="font-semibold text-[#111214] dark:text-[#F4F4F0]">{ann.title}</span>
                <span className="mx-2 text-[#8E939E]">·</span>
                <span className="text-[#5A5D65] dark:text-[#9CA0AA]">{ann.message}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 1. Hero / Search + Quick Tools (immediately visible above/near fold) */}
      <section className="rikzen-hero-glow border-b border-[#E2DED4]/70 dark:border-[#1E222C]/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-7 sm:pt-11 pb-10 sm:pb-14 space-y-8">
          <div className="max-w-3xl mx-auto text-center space-y-4">
            <p className="text-xs sm:text-sm font-bold tracking-wider uppercase text-[#B88E1E] dark:text-[#D4AF37]">
              RIKZEN ALL-IN-ONE TOOLS · {t.tagline}
            </p>
            <h1
              className="text-3xl sm:text-5xl font-extrabold tracking-tight text-[#111214] dark:text-[#F4F4F0] leading-[1.1]"
              style={{ textWrap: 'balance' }}
            >
              {t.heroTitle}
            </h1>

            {/* Search box */}
            <div className="relative max-w-2xl mx-auto pt-1">
              <div className="rikzen-card flex items-center gap-3 rounded-2xl border border-[#DAD4C7] dark:border-[#282D3A] bg-white dark:bg-[#12151B] px-4 sm:px-5 min-h-[54px] focus-within:border-[#C9A227] focus-within:ring-2 focus-within:ring-[#C9A227]/15 transition-all">
                <Search className="w-5 h-5 text-[#C9A227] shrink-0" />
                <input
                  type="search"
                  value={heroQuery}
                  onChange={(e) => setHeroQuery(e.target.value)}
                  placeholder={t.searchPlaceholder}
                  aria-label="Search tools"
                  className="w-full bg-transparent text-base text-[#111214] dark:text-[#F4F4F0] placeholder:text-[#8E939E] focus:outline-none"
                />
                {heroQuery && (
                  <button
                    type="button"
                    onClick={() => setHeroQuery('')}
                    className="text-xs font-semibold text-[#6B707B] hover:text-[#111214] dark:hover:text-[#F4F4F0] cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </div>

              {heroQuery.trim() && (
                <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-20 rounded-2xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] shadow-2xl overflow-hidden text-left">
                  {liveSearchResults.length === 0 ? (
                    <div className="p-5 text-sm text-[#6B707B] dark:text-[#9CA0AA] text-center">
                      No matching tools for "{heroQuery}".
                    </div>
                  ) : (
                    <div className="divide-y divide-[#EFECE4] dark:divide-[#1E222C] max-h-80 overflow-y-auto">
                      {liveSearchResults.map((tool) => (
                        <button
                          key={tool.id}
                          type="button"
                          onClick={() => onNavigate(tool.route)}
                          className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-[#FAF8F4] dark:hover:bg-[#171B22] transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span
                              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                                CATEGORY_STATIC_ICON_STYLES[tool.category]
                              }`}
                            >
                              <ToolIcon name={tool.icon} className="w-4 h-4" />
                            </span>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-[#111214] dark:text-[#F4F4F0] truncate">
                                {tool.name}
                              </div>
                              <div className="text-xs text-[#6B707B] dark:text-[#9CA0AA] truncate">
                                {tool.supportedFormats.join(' / ')}
                              </div>
                            </div>
                          </div>
                          <ArrowRight className="w-4 h-4 text-[#C9A227] shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 2. Quick Tools (8 core everyday utilities immediately accessible) */}
          <div className="space-y-3.5">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[#5A5D65] dark:text-[#9CA0AA]">
                Quick Tools
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('/tools')}
                className="text-xs font-semibold text-[#B88E1E] dark:text-[#D4AF37] hover:underline whitespace-nowrap cursor-pointer"
              >
                Browse all {TOOL_REGISTRY.length} →
              </button>
            </div>
            <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3">
              {quickTools.map((tool) => (
                <ToolCard
                  key={tool.id}
                  tool={tool}
                  compact
                  featured={tool.id === 'qr-generator'}
                  subtitleOverride={
                    tool.id === 'qr-generator'
                      ? 'Create QR from anything'
                      : tool.id === 'jpg-to-pdf'
                      ? 'Image → PDF'
                      : undefined
                  }
                  onOpen={onNavigate}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 3. Popular Tools */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl sm:text-2xl font-bold text-[#111214] dark:text-[#F4F4F0]">
            {t.popularTools}
          </h2>
          <button
            type="button"
            onClick={() => onNavigate('/tools')}
            className="text-sm font-semibold text-[#B88E1E] dark:text-[#D4AF37] hover:underline whitespace-nowrap cursor-pointer"
          >
            All {TOOL_REGISTRY.length} tools
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {popularTools.map((tool) => (
            <ToolCard
              key={tool.id}
              tool={tool}
              onOpen={onNavigate}
              onRequireAuth={onOpenAuthModal}
            />
          ))}
        </div>
      </section>

      {/* 4. Recently Used */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl sm:text-2xl font-bold text-[#111214] dark:text-[#F4F4F0]">
            {t.recentlyUsed}
          </h2>
          {user && recentTools.length > 0 && (
            <button
              type="button"
              onClick={() => onNavigate('/history')}
              className="text-sm font-semibold text-[#B88E1E] dark:text-[#D4AF37] hover:underline cursor-pointer"
            >
              Full history
            </button>
          )}
        </div>

        {user && recentTools.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {recentTools.map(({ tool, entry }) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onNavigate(tool.route)}
                className="rikzen-card rounded-2xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-4 flex items-center gap-3.5 text-left hover:border-[#C9A227] transition-all active:scale-[0.99] cursor-pointer"
              >
                <span
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    CATEGORY_STATIC_ICON_STYLES[tool.category]
                  }`}
                >
                  <ToolIcon name={tool.icon} className="w-5 h-5" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-[#111214] dark:text-[#F4F4F0] truncate">
                    {tool.name}
                  </div>
                  <div className="text-xs text-[#6B707B] dark:text-[#9CA0AA] truncate">
                    {entry.fileName || 'Completed'} · {formatRelativeDate(entry.createdAt)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="w-11 h-11 rounded-2xl bg-[#C9A227]/12 text-[#B88E1E] dark:text-[#D4AF37] flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5" />
              </span>
              <div>
                <p className="text-sm font-bold text-[#111214] dark:text-[#F4F4F0]">
                  {user ? t.noHistoryTitle : 'Your recent tools & files'}
                </p>
                <p className="text-xs sm:text-sm text-[#5A5D65] dark:text-[#9CA0AA] mt-0.5">
                  {user
                    ? t.noHistoryDesc
                    : 'Sign in with Google to save favorites and track processed files across sessions.'}
                </p>
              </div>
            </div>
            {!user && (
              <button
                type="button"
                onClick={onOpenAuthModal}
                className="min-h-[44px] px-5 rounded-xl bg-gradient-to-b from-[#1C1E24] to-[#0E1014] dark:from-[#E0BC46] dark:to-[#C59D24] text-white dark:text-[#0B0C0E] text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer shadow-sm"
              >
                {t.continueGoogle}
              </button>
            )}
          </div>
        )}
      </section>

      {/* 5. Saved Favorites (when available) */}
      {favoriteTools.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 space-y-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl sm:text-2xl font-bold text-[#111214] dark:text-[#F4F4F0] flex items-center gap-2">
              <Star className="w-5 h-5 text-[#C9A227] fill-current" />
              <span>{t.yourFavorites}</span>
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('/favorites')}
              className="text-sm font-semibold text-[#B88E1E] dark:text-[#D4AF37] hover:underline whitespace-nowrap cursor-pointer"
            >
              View all
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {favoriteTools.slice(0, 4).map((tool) => (
              <ToolCard
                key={tool.id}
                tool={tool}
                onOpen={onNavigate}
                onRequireAuth={onOpenAuthModal}
              />
            ))}
          </div>
        </section>
      )}

      {/* 6. All Tools / Categories */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl sm:text-2xl font-bold text-[#111214] dark:text-[#F4F4F0]">
            {t.categories}
          </h2>
          <button
            type="button"
            onClick={() => onNavigate('/tools')}
            className="text-sm font-semibold text-[#B88E1E] dark:text-[#D4AF37] hover:underline whitespace-nowrap cursor-pointer"
          >
            Explore directory
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => onNavigate(`/tools?category=${cat.id}`)}
              className="group rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-5 text-left hover:border-[#C9A227] hover:-translate-y-0.5 transition-all flex flex-col justify-between gap-5 cursor-pointer"
            >
              <span
                className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${
                  CATEGORY_ICON_STYLES[cat.id]
                }`}
              >
                <ToolIcon name={cat.icon} className="w-5 h-5" />
              </span>
              <div>
                <h3 className="text-base font-bold text-[#111214] dark:text-[#F4F4F0]">
                  {cat.name}
                </h3>
                <p className="mt-1 text-xs text-[#5A5D65] dark:text-[#9CA0AA] leading-relaxed">
                  {cat.shortDesc}
                </p>
                <p className="mt-3 text-xs font-mono tabular-nums font-semibold text-[#B88E1E] dark:text-[#D4AF37]">
                  {countByCategory(cat.id)} tools
                </p>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* 7. Why RIKZEN */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 space-y-6">
        <h2 className="text-xl sm:text-2xl font-bold text-[#111214] dark:text-[#F4F4F0]">
          Why RIKZEN
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {[
            {
              icon: Zap,
              title: 'Zero learning curve',
              desc: 'Upload, customize if needed, and download. No confusing multi-page traps.',
            },
            {
              icon: Sparkles,
              title: 'Batch-ready engines',
              desc: `Handle up to ${capabilities.maxFilesPerBatch} files per batch with controlled queuing and instant ZIP exports.`,
            },
            {
              icon: ShieldCheck,
              title: 'Mobile-first speed',
              desc: 'Large touch targets, dark mode, and installable PWA support.',
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.title}
                className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-6 space-y-3"
              >
                <span className="w-11 h-11 rounded-2xl bg-[#C9A227]/12 text-[#B88E1E] dark:text-[#D4AF37] flex items-center justify-center">
                  <Icon className="w-5 h-5" />
                </span>
                <h3 className="text-base font-bold text-[#111214] dark:text-[#F4F4F0]">
                  {item.title}
                </h3>
                <p className="text-sm text-[#5A5D65] dark:text-[#9CA0AA] leading-relaxed">
                  {item.desc}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* 8. Security / Privacy section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="rikzen-card rounded-3xl border border-[#2A2F3D] bg-gradient-to-br from-[#12141A] via-[#151820] to-[#0B0D11] text-[#FAFAF8] p-7 sm:p-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2.5 max-w-2xl">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#D4AF37]">
              <Lock className="w-4 h-4" />
              <span>Security & Privacy</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Your files stay private and auto-delete.
            </h2>
            <p className="text-sm text-[#B8BCC6] leading-relaxed">
              Uploads are validated by magic bytes, capped at {capabilities.maxFileSizeMb} MB/file ({capabilities.maxTotalBatchSizeMb} MB/batch), isolated per account, and auto-deleted after {capabilities.tempTtlMinutes} minutes.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/security')}
            className="min-h-[46px] px-6 rounded-2xl bg-gradient-to-b from-[#E0BC46] to-[#C59D24] text-[#0B0C0E] text-sm font-bold whitespace-nowrap shrink-0 hover:opacity-95 transition-opacity cursor-pointer self-start lg:self-center shadow-sm"
          >
            Read Security Overview
          </button>
        </div>
      </section>
    </div>
  );
};
