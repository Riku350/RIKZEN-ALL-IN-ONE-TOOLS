import React from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { RikzenLogo } from './RikzenLogo';

interface GoogleAuthCardProps {
  title?: string;
  subtitle?: string;
  onSuccess?: () => void;
}

export const GoogleAuthCard: React.FC<GoogleAuthCardProps> = ({
  title = 'Sign in to RIKZEN',
  subtitle = 'Save favorites, track recent activity, and access your processed files privately.',
  onSuccess,
}) => {
  const { signInWithGoogle, isSigningIn, authError, clearAuthError } = useAuth();
  const { t } = useApp();

  const handleLogin = async () => {
    clearAuthError();
    const ok = await signInWithGoogle();
    if (ok && onSuccess) {
      onSuccess();
    }
  };

  return (
    <div className="w-full max-w-md mx-auto rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-7 sm:p-8 shadow-sm text-center">
      <div className="flex justify-center mb-5">
        <RikzenLogo size="md" />
      </div>
      <h2 className="text-xl font-bold text-[#111214] dark:text-[#F4F4F0]">{title}</h2>
      <p className="mt-2 text-sm text-[#5A5D65] dark:text-[#9CA0AA] leading-relaxed">
        {subtitle}
      </p>

      {authError && (
        <div
          role="alert"
          className="mt-4 rounded-2xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-xs font-medium text-red-800 dark:text-red-200 text-left"
        >
          {authError}
        </div>
      )}

      <button
        type="button"
        disabled={isSigningIn}
        onClick={() => void handleLogin()}
        className="mt-6 w-full min-h-[48px] rounded-2xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#111214] dark:bg-[#F4F4F0] text-white dark:text-[#0B0C0E] px-5 py-3 text-sm font-semibold flex items-center justify-center gap-3 hover:opacity-92 transition-opacity disabled:opacity-60 cursor-pointer"
      >
        {isSigningIn ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
            <path
              fill="#4285F4"
              d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.51-1.14 2.79-2.4 3.65l3.87 3.01c2.26-2.09 3.55-5.17 3.55-8.9z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#34A853"
              d="M12 23c3.24 0 5.95-1.08 7.93-2.91l-3.87-3.01c-1.07.72-2.44 1.14-4.06 1.14-3.12 0-5.77-2.11-6.72-4.96l-3.66 2.84C3.99 20.53 7.7 23 12 23z"
            />
          </svg>
        )}
        <span>{isSigningIn ? 'Connecting to Google...' : t.continueGoogle}</span>
      </button>

      <div className="mt-5 flex items-center justify-center gap-2 text-xs text-[#6B707B] dark:text-[#8E939E]">
        <ShieldCheck className="w-4 h-4 text-[#C9A227] shrink-0" />
        <span>Verified Google OAuth · Private account workspace</span>
      </div>
    </div>
  );
};
