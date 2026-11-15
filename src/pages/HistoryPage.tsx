import React, { useState } from 'react';
import { Clock, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { GoogleAuthCard } from '../components/GoogleAuthCard';
import { findToolById } from '../lib/toolRegistry';
import { ToolIcon } from '../components/ToolIcon';
import { formatBytes, formatRelativeDate } from '../lib/formatters';

export const HistoryPage: React.FC<{ onNavigate: (path: string) => void }> = ({
  onNavigate,
}) => {
  const { user, loading, history, clearUserHistory } = useAuth();
  const { t, notify } = useApp();
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-3">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className="h-16 rounded-2xl bg-[#EAEAE4] dark:bg-[#1B1E26] animate-pulse" />
        ))}
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 pb-24">
        <GoogleAuthCard
          title="Tool History"
          subtitle="Sign in with Google to see your recent conversions, compressions, and utility runs."
        />
      </div>
    );
  }

  const handleClear = async () => {
    setClearing(true);
    try {
      await clearUserHistory();
      setConfirmClear(false);
      notify('History cleared.', 'success');
    } catch {
      notify('Could not clear history.', 'error');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-6 pb-24 md:pb-16">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#111214] dark:text-[#F4F4F0]">
            {t.navHistory}
          </h1>
          <p className="text-sm text-[#5A5D65] dark:text-[#9CA0AA] mt-1">
            Recent activity across your RIKZEN tools
          </p>
        </div>

        {history.length > 0 && (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="min-h-[42px] px-4 rounded-xl border border-[#DADAD4] dark:border-[#2C303A] text-xs font-semibold text-red-600 dark:text-red-400 inline-flex items-center gap-1.5 hover:border-red-400 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t.clearHistory}</span>
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-12 text-center space-y-4">
          <span className="mx-auto w-14 h-14 rounded-2xl bg-[#F4F2EC] dark:bg-[#1C1F26] text-[#C9A227] flex items-center justify-center">
            <Clock className="w-6 h-6" />
          </span>
          <h2 className="text-lg font-bold">{t.noHistoryTitle}</h2>
          <p className="text-sm text-[#5A5D65] dark:text-[#9CA0AA]">{t.noHistoryDesc}</p>
          <button
            type="button"
            onClick={() => onNavigate('/tools')}
            className="min-h-[44px] px-6 rounded-xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-sm font-semibold cursor-pointer"
          >
            {t.exploreTools}
          </button>
        </div>
      ) : (
        <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] divide-y divide-[#ECE8DE] dark:divide-[#1E2128]">
          {history.map((item) => {
            const def = findToolById(item.toolId);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => def && onNavigate(def.route)}
                className="w-full p-4 sm:p-5 flex items-center justify-between gap-4 text-left hover:bg-[#FAFAF8] dark:hover:bg-[#181B22] transition-colors first:rounded-t-3xl last:rounded-b-3xl cursor-pointer"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <span className="w-10 h-10 rounded-xl bg-[#F4F2EC] dark:bg-[#1C1F26] text-[#C9A227] flex items-center justify-center shrink-0">
                    <ToolIcon name={def?.icon || 'Sparkles'} className="w-5 h-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#111214] dark:text-[#F4F4F0] truncate">
                      {item.toolName}
                    </p>
                    <p className="text-xs text-[#6B707B] dark:text-[#9CA0AA] truncate mt-0.5">
                      {item.fileName || 'Completed'}
                      {item.outputSizeBytes
                        ? ` · ${formatBytes(item.outputSizeBytes)}`
                        : ''}
                    </p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div
                    className={`text-xs font-semibold ${
                      item.status === 'completed'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {item.status === 'completed' ? 'Done' : 'Failed'}
                  </div>
                  <div className="text-xs font-mono tabular-nums text-[#6B707B] dark:text-[#8E939E] mt-0.5">
                    {formatRelativeDate(item.createdAt)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {confirmClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-6 space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold">Clear all history?</h3>
            <p className="text-sm text-[#5A5D65] dark:text-[#9CA0AA]">
              This will permanently remove your recent tool activity log.
            </p>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="flex-1 min-h-[44px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] text-sm font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={clearing}
                onClick={() => void handleClear()}
                className="flex-1 min-h-[44px] rounded-xl bg-red-600 text-white text-sm font-semibold cursor-pointer disabled:opacity-60"
              >
                {clearing ? 'Clearing...' : 'Clear'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
