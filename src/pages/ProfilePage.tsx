import React from 'react';
import { Globe, LogOut, Moon, QrCode, Shield, ShieldCheck, Sun } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { GoogleAuthCard } from '../components/GoogleAuthCard';
import { LanguageCode } from '../lib/i18n';
import { PWAInstallButton } from '../components/PWAInstallButton';

export const ProfilePage: React.FC<{ onNavigate: (path: string) => void }> = ({
  onNavigate,
}) => {
  const { user, profile, loading, isAdmin, logout } = useAuth();
  const { theme, setTheme, language, setLanguage, t } = useApp();

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-4">
        <div className="h-32 rounded-3xl bg-[#EAEAE4] dark:bg-[#1B1E26] animate-pulse" />
        <div className="h-48 rounded-3xl bg-[#EAEAE4] dark:bg-[#1B1E26] animate-pulse" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 pb-24">
        <GoogleAuthCard />
      </div>
    );
  }

  const createdStr = profile?.createdAt
    ? profile.createdAt.toLocaleDateString(undefined, {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : '2026';

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-6 pb-24 md:pb-16">
      {/* User Identity Card */}
      <div className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-6 sm:p-7 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
        <div className="flex items-center gap-4 min-w-0">
          {profile?.photoURL || user.photoURL ? (
            <img
              src={profile?.photoURL || user.photoURL || ''}
              alt={profile?.displayName || 'User'}
              referrerPolicy="no-referrer"
              className="w-16 h-16 rounded-2xl object-cover border border-[#E5E5E0] dark:border-[#262932] shrink-0"
            />
          ) : (
            <span className="w-16 h-16 rounded-2xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] flex items-center justify-center text-xl font-bold shrink-0">
              {(profile?.displayName || user.email || 'R').slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-[#111214] dark:text-[#F4F4F0] truncate">
              {profile?.displayName || user.displayName || 'RIKZEN User'}
            </h1>
            <p className="text-sm text-[#5A5D65] dark:text-[#9CA0AA] truncate">
              {profile?.email || user.email}
            </p>
            <p className="text-xs text-[#6B707B] dark:text-[#8E939E] mt-1">
              Member since {createdStr}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void logout()}
          className="min-h-[44px] px-5 rounded-xl border border-[#DADAD4] dark:border-[#2C303A] text-sm font-semibold text-red-600 dark:text-red-400 inline-flex items-center justify-center gap-2 hover:border-red-400 cursor-pointer shrink-0"
        >
          <LogOut className="w-4 h-4" />
          <span>{t.logout}</span>
        </button>
      </div>

      {/* Settings */}
      <div className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] divide-y divide-[#F0F0EC] dark:divide-[#1E2128]">
        {/* Theme */}
        <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {theme === 'dark' ? (
              <Moon className="w-5 h-5 text-[#D4AF37]" />
            ) : (
              <Sun className="w-5 h-5 text-[#C9A227]" />
            )}
            <div>
              <h2 className="text-sm font-bold">Theme</h2>
              <p className="text-xs text-[#5A5D65] dark:text-[#9CA0AA]">
                Choose Light or Dark appearance
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#F4F2EC] dark:bg-[#0F1116]">
            {(['light', 'dark'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setTheme(mode)}
                className={`min-h-[38px] px-4 rounded-lg text-xs font-semibold capitalize transition-colors cursor-pointer ${
                  theme === mode
                    ? 'bg-white dark:bg-[#1F232C] text-[#111214] dark:text-[#F4F4F0] shadow-xs'
                    : 'text-[#6B707B]'
                }`}
              >
                {mode} Mode
              </button>
            ))}
          </div>
        </div>

        {/* Language */}
        <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Globe className="w-5 h-5 text-[#C9A227]" />
            <div>
              <h2 className="text-sm font-bold">Language</h2>
              <p className="text-xs text-[#5A5D65] dark:text-[#9CA0AA]">
                Switch interface labels
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#F4F2EC] dark:bg-[#0F1116]">
            {(
              [
                { code: 'en', label: 'English' },
                { code: 'hi', label: 'हिन्दी' },
                { code: 'hinglish', label: 'Hinglish' },
              ] as { code: LanguageCode; label: string }[]
            ).map((opt) => (
              <button
                key={opt.code}
                type="button"
                onClick={() => setLanguage(opt.code)}
                className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  language === opt.code
                    ? 'bg-white dark:bg-[#1F232C] text-[#111214] dark:text-[#F4F4F0] shadow-xs'
                    : 'text-[#6B707B]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* My QR Codes */}
        <div className="p-5 sm:p-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <QrCode className="w-5 h-5 text-[#C9A227]" />
            <div>
              <h2 className="text-sm font-bold">My QR Codes</h2>
              <p className="text-xs text-[#5A5D65] dark:text-[#9CA0AA]">
                Manage saved Link, Image, Video, File &amp; Wi-Fi QR codes
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/qr-codes')}
            className="min-h-[38px] px-4 rounded-xl border border-[#DADAD4] dark:border-[#2C303A] text-xs font-semibold hover:border-[#C9A227] cursor-pointer"
          >
            Open
          </button>
        </div>

        {/* Security */}
        <div className="p-5 sm:p-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-[#C9A227]" />
            <div>
              <h2 className="text-sm font-bold">Security & Privacy</h2>
              <p className="text-xs text-[#5A5D65] dark:text-[#9CA0AA]">
                Google OAuth verified · Temporary files auto-delete
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/security')}
            className="min-h-[38px] px-4 rounded-xl border border-[#DADAD4] dark:border-[#2C303A] text-xs font-semibold cursor-pointer"
          >
            Details
          </button>
        </div>

        {/* Admin Console link (strictly visible to verified admins) */}
        {isAdmin && (
          <div className="p-5 sm:p-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Shield className="w-5 h-5 text-[#C9A227]" />
              <div>
                <h2 className="text-sm font-bold">Admin Console</h2>
                <p className="text-xs text-[#5A5D65] dark:text-[#9CA0AA]">
                  Usage metrics, tool limits, users, and announcements
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('/admin')}
              className="min-h-[38px] px-4 rounded-xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-xs font-semibold cursor-pointer"
            >
              Open Admin
            </button>
          </div>
        )}
      </div>

      <PWAInstallButton variant="card" />
    </div>
  );
};
