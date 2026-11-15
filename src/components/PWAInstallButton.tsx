import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC<{ variant?: 'compact' | 'card' }> = ({
  variant = 'compact',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className={
          variant === 'card'
            ? 'w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] px-4 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 cursor-pointer'
            : 'min-h-[40px] flex items-center gap-2 rounded-xl border border-[#E5E5E0] dark:border-[#262932] bg-white dark:bg-[#15171C] px-3.5 py-2 text-xs font-semibold text-[#111214] dark:text-[#F4F4F0] hover:border-[#C9A227] transition-colors whitespace-nowrap shrink-0 cursor-pointer'
        }
      >
        <Download className="w-4 h-4 text-[#C9A227] dark:text-current" />
        <span>Install App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={
            variant === 'card'
              ? 'w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl border border-[#E5E5E0] dark:border-[#262932] bg-white dark:bg-[#15171C] px-4 py-2.5 text-sm font-semibold text-[#111214] dark:text-[#F4F4F0] cursor-pointer'
              : 'min-h-[40px] flex items-center gap-2 rounded-xl border border-[#E5E5E0] dark:border-[#262932] px-3 py-1.5 text-xs font-semibold text-[#111214] dark:text-[#F4F4F0] whitespace-nowrap shrink-0 cursor-pointer'
          }
        >
          <Download className="w-3.5 h-3.5 text-[#C9A227]" />
          <span>Install App</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#15171C] border border-[#E5E5E0] dark:border-[#262932] p-6 shadow-2xl">
              <h3 className="text-lg font-bold text-[#111214] dark:text-[#F4F4F0]">
                Install RIKZEN on iOS
              </h3>
              <p className="mt-2 text-sm text-[#5A5D65] dark:text-[#9CA0AA] leading-relaxed">
                1. Tap the <strong>Share</strong> button in Safari.
                <br />
                2. Scroll down and select <strong>Add to Home Screen</strong>.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full min-h-[44px] rounded-xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-sm font-semibold cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
