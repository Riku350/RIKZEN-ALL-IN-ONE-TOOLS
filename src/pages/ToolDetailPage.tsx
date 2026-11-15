import React, { Suspense, lazy, useEffect } from 'react';
import { ArrowLeft, Star } from 'lucide-react';
import { CATEGORIES, findToolById } from '../lib/toolRegistry';
import { CATEGORY_STATIC_ICON_STYLES } from '../lib/categoryStyles';
import { ToolIcon } from '../components/ToolIcon';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { trackAnalyticsEvent } from '../lib/formatters';

const ImageToolWorkspace = lazy(() =>
  import('../components/tools/ImageToolWorkspace').then((m) => ({ default: m.ImageToolWorkspace }))
);
const PdfToolWorkspace = lazy(() =>
  import('../components/tools/PdfToolWorkspace').then((m) => ({ default: m.PdfToolWorkspace }))
);
const DocumentToolWorkspace = lazy(() =>
  import('../components/tools/DocumentToolWorkspace').then((m) => ({ default: m.DocumentToolWorkspace }))
);
const StudentToolWorkspace = lazy(() =>
  import('../components/tools/StudentToolWorkspace').then((m) => ({ default: m.StudentToolWorkspace }))
);
const UtilityToolWorkspace = lazy(() =>
  import('../components/tools/UtilityToolWorkspace').then((m) => ({ default: m.UtilityToolWorkspace }))
);

interface ToolDetailPageProps {
  toolId: string;
  onNavigate: (path: string) => void;
  onOpenAuthModal: () => void;
}

export const ToolDetailPage: React.FC<ToolDetailPageProps> = ({
  toolId,
  onNavigate,
  onOpenAuthModal,
}) => {
  const tool = findToolById(toolId);
  const { user, favorites, toggleFavorite } = useAuth();
  const { toolConfigs } = useApp();

  // Dynamic SEO page title & meta description per tool URL
  useEffect(() => {
    if (!tool) return;
    document.title = `${tool.name} — RIKZEN All-in-One Tools`;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute('content', tool.description);
    void trackAnalyticsEvent('tool_opened', tool.id, tool.category);

    return () => {
      document.title = 'RIKZEN All-in-One Tools — Free Online Tools';
      if (metaDesc) {
        metaDesc.setAttribute(
          'content',
          'Use powerful image, PDF, document, QR and student tools in one simple place with RIKZEN.'
        );
      }
    };
  }, [tool]);

  if (!tool) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-center space-y-4">
        <h1 className="text-2xl font-bold">Tool not found</h1>
        <p className="text-sm text-[#5A5D65] dark:text-[#9CA0AA]">
          That tool URL does not exist. Choose a tool from our directory.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('/tools')}
          className="min-h-[44px] px-6 rounded-xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-sm font-semibold cursor-pointer"
        >
          Browse All Tools
        </button>
      </div>
    );
  }

  const categoryMeta = CATEGORIES.find((c) => c.id === tool.category);
  const isFav = favorites.includes(tool.id);
  const isDisabled = toolConfigs[tool.id]?.enabled === false;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-7 sm:py-10 space-y-6 pb-24 md:pb-16">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onNavigate(`/tools?category=${tool.category}`)}
          className="min-h-[40px] inline-flex items-center gap-2 text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA] hover:text-[#111214] dark:hover:text-[#F4F4F0] cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{categoryMeta?.name || 'Tools'}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (!user) {
              onOpenAuthModal();
              return;
            }
            void toggleFavorite(tool.id, tool.category);
          }}
          className={`min-h-[40px] px-3.5 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
            isFav
              ? 'border-[#C9A227] bg-[#C9A227]/12 text-[#B88E1E] dark:text-[#D4AF37]'
              : 'border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] text-[#5A5D65] dark:text-[#9CA0AA] hover:border-[#C9A227]'
          }`}
        >
          <Star className={`w-3.5 h-3.5 ${isFav ? 'fill-current' : ''}`} />
          <span>{isFav ? 'Saved' : 'Save'}</span>
        </button>
      </div>

      <div className="flex items-start gap-4">
        <span className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${CATEGORY_STATIC_ICON_STYLES[tool.category]}`}>
          <ToolIcon name={tool.icon} className="w-6 h-6" />
        </span>
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#111214] dark:text-[#F4F4F0]">
            {tool.name}
          </h1>
          <p className="mt-1 text-sm text-[#5A5D65] dark:text-[#9CA0AA]">{tool.description}</p>
        </div>
      </div>

      {isDisabled ? (
        <div className="rounded-3xl border border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 p-7 text-sm text-amber-900 dark:text-amber-200">
          This tool is temporarily paused by the administrator. Please check back shortly.
        </div>
      ) : (
        <Suspense
          fallback={
            <div className="h-64 rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] animate-pulse" />
          }
        >
          {tool.category === 'image' && <ImageToolWorkspace tool={tool} />}
          {tool.category === 'pdf' && <PdfToolWorkspace tool={tool} />}
          {tool.category === 'document' && <DocumentToolWorkspace tool={tool} />}
          {tool.category === 'student' && <StudentToolWorkspace tool={tool} />}
          {tool.category === 'utility' && <UtilityToolWorkspace tool={tool} onNavigate={onNavigate} />}
        </Suspense>
      )}
    </div>
  );
};
