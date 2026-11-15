import React from 'react';
import { ArrowRight, Star } from 'lucide-react';
import { ToolDefinition } from '../lib/toolRegistry';
import { CATEGORY_ICON_STYLES } from '../lib/categoryStyles';
import { ToolIcon } from './ToolIcon';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';

interface ToolCardProps {
  tool: ToolDefinition;
  onOpen: (route: string) => void;
  onRequireAuth?: () => void;
  compact?: boolean;
  featured?: boolean;
  subtitleOverride?: string;
}

export const ToolCard: React.FC<ToolCardProps> = ({
  tool,
  onOpen,
  onRequireAuth,
  compact = false,
  featured = false,
  subtitleOverride,
}) => {
  const { user, favorites, toggleFavorite } = useAuth();
  const { capabilities, toolConfigs } = useApp();
  const isFav = favorites.includes(tool.id);

  const isDisabledByAdmin = toolConfigs[tool.id]?.enabled === false;
  const missingCapability =
    tool.requiresCapability && !capabilities[tool.requiresCapability];

  const iconStyle = CATEGORY_ICON_STYLES[tool.category];

  const handleStar = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) {
      onRequireAuth?.();
      return;
    }
    void toggleFavorite(tool.id, tool.category);
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => onOpen(tool.route)}
        className={`group rikzen-card min-h-[82px] rounded-2xl border p-4 flex items-center gap-3.5 text-left hover:border-[#C9A227] hover:-translate-y-0.5 transition-all active:scale-[0.98] cursor-pointer ${
          featured
            ? 'border-[#C9A227]/75 bg-gradient-to-br from-[#FFFDF7] via-white to-[#F9F2DF] dark:from-[#17181E] dark:via-[#14161D] dark:to-[#1E1A11] ring-1 ring-[#C9A227]/25 shadow-sm'
            : 'border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B]'
        }`}
      >
        <span
          className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 transition-colors ${
            featured
              ? 'bg-gradient-to-b from-[#E5C453] to-[#C59D24] text-[#0B0C0E] shadow-xs'
              : iconStyle
          }`}
        >
          <ToolIcon name={tool.icon} className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-[#111214] dark:text-[#F4F4F0] leading-tight truncate">
            {tool.shortLabel}
          </div>
          <div
            className={`text-[11px] font-medium mt-0.5 truncate ${
              featured
                ? 'text-[#9A7410] dark:text-[#D4AF37] font-semibold'
                : 'text-[#6B707B] dark:text-[#9CA0AA]'
            }`}
          >
            {subtitleOverride || tool.supportedFormats.slice(0, 3).join(' · ')}
          </div>
        </div>
        <ArrowRight className="w-4 h-4 text-[#C9A227] opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all shrink-0 hidden sm:block" />
      </button>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(tool.route)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(tool.route);
        }
      }}
      className="group rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-5 flex flex-col justify-between gap-4 hover:border-[#C9A227] hover:-translate-y-0.5 transition-all active:scale-[0.99] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]"
    >
      <div>
        <div className="flex items-start justify-between gap-3">
          <span
            className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 transition-colors ${iconStyle}`}
          >
            <ToolIcon name={tool.icon} className="w-5 h-5" />
          </span>

          <button
            type="button"
            onClick={handleStar}
            aria-label={isFav ? `Remove ${tool.name} from favorites` : `Save ${tool.name} to favorites`}
            className={`min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
              isFav
                ? 'text-[#C9A227] dark:text-[#D4AF37] bg-[#C9A227]/12'
                : 'text-[#8E939E] hover:text-[#111214] dark:hover:text-[#F4F4F0] hover:bg-[#F4F1EA] dark:hover:bg-[#191D25]'
            }`}
          >
            <Star className={`w-4 h-4 ${isFav ? 'fill-current' : ''}`} />
          </button>
        </div>

        <h3 className="mt-4 text-base font-bold text-[#111214] dark:text-[#F4F4F0] leading-snug">
          {tool.name}
        </h3>
        <p className="mt-1.5 text-sm text-[#5A5D65] dark:text-[#9CA0AA] line-clamp-2 leading-relaxed">
          {tool.description}
        </p>
      </div>

      <div className="pt-3 border-t border-[#EFECE4] dark:border-[#1E222B] flex items-center justify-between gap-2 text-xs text-[#6B707B] dark:text-[#8E939E]">
        <span className="truncate font-medium">
          {isDisabledByAdmin
            ? 'Paused by Admin'
            : missingCapability
            ? 'API key required for AI cutout'
            : tool.supportedFormats.join(' · ')}
        </span>
        <ArrowRight className="w-4 h-4 text-[#C9A227] opacity-75 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all shrink-0" />
      </div>
    </div>
  );
};
