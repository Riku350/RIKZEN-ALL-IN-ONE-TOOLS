import React from 'react';
import { Star } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { findToolById } from '../lib/toolRegistry';
import { GoogleAuthCard } from '../components/GoogleAuthCard';
import { ToolCard } from '../components/ToolCard';

export const FavoritesPage: React.FC<{ onNavigate: (path: string) => void }> = ({
  onNavigate,
}) => {
  const { user, loading, favorites } = useAuth();
  const { t } = useApp();

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[1, 2, 3].map((n) => (
          <div key={n} className="h-44 rounded-3xl bg-[#EAEAE4] dark:bg-[#1B1E26] animate-pulse" />
        ))}
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 pb-24">
        <GoogleAuthCard
          title="Saved Tools"
          subtitle="Sign in with Google to bookmark your favorite tools for one-tap access."
        />
      </div>
    );
  }

  const savedTools = favorites
    .map((id) => findToolById(id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-6 pb-24 md:pb-16">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#111214] dark:text-[#F4F4F0]">
          {t.yourFavorites}
        </h1>
        <p className="text-sm text-[#5A5D65] dark:text-[#9CA0AA] mt-1">
          {savedTools.length} saved tool{savedTools.length === 1 ? '' : 's'}
        </p>
      </div>

      {savedTools.length === 0 ? (
        <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-12 text-center space-y-4">
          <span className="mx-auto w-14 h-14 rounded-2xl bg-[#F4F2EC] dark:bg-[#1C1F26] text-[#C9A227] flex items-center justify-center">
            <Star className="w-6 h-6" />
          </span>
          <h2 className="text-lg font-bold">{t.noFavoritesTitle}</h2>
          <p className="text-sm text-[#5A5D65] dark:text-[#9CA0AA]">{t.noFavoritesDesc}</p>
          <button
            type="button"
            onClick={() => onNavigate('/tools')}
            className="min-h-[44px] px-6 rounded-xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-sm font-semibold cursor-pointer"
          >
            {t.exploreTools}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {savedTools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} onOpen={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
};
