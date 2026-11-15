import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { LanguageCode, TranslationKeys, getTranslations } from '../lib/i18n';
import { useAuth } from './AuthContext';

export interface BackendCapabilities {
  removeBgConfigured: boolean;
  qpdfAvailable: boolean;
  maxUploadMb: number;
  maxFileSizeMb: number;
  maxFilesPerBatch: number;
  maxTotalBatchSizeMb: number;
  maxProcessingTimeMs: number;
  maxConcurrentJobs: number;
  tempTtlMinutes: number;
  maxQrImageMb: number;
  maxQrVideoMb: number;
  maxQrFileMb: number;
  maxQrStoragePerUserMb: number;
}

export interface AnnouncementItem {
  id: string;
  title: string;
  message: string;
}

export interface ToolOverrideConfig {
  enabled: boolean;
  maxFileSizeMb: number;
}

interface ToastMessage {
  id: string;
  type: 'info' | 'success' | 'error';
  text: string;
}

interface AppContextValue {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  setTheme: (next: 'light' | 'dark') => void;
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  t: TranslationKeys;
  capabilities: BackendCapabilities;
  announcements: AnnouncementItem[];
  toolConfigs: Record<string, ToolOverrideConfig>;
  refreshPublicConfig: () => Promise<void>;
  notify: (text: string, type?: 'info' | 'success' | 'error') => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile, updateUserPreferences } = useAuth();

  const [theme, setThemeState] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('rikzen-theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  const [language, setLanguageState] = useState<LanguageCode>(() => {
    const saved = localStorage.getItem('rikzen-lang');
    if (saved === 'en' || saved === 'hi' || saved === 'hinglish') return saved;
    return 'en';
  });

  const [capabilities, setCapabilities] = useState<BackendCapabilities>({
    removeBgConfigured: false,
    qpdfAvailable: false,
    maxUploadMb: 100,
    maxFileSizeMb: 100,
    maxFilesPerBatch: 50,
    maxTotalBatchSizeMb: 1000,
    maxProcessingTimeMs: 120000,
    maxConcurrentJobs: 4,
    tempTtlMinutes: 30,
    maxQrImageMb: 25,
    maxQrVideoMb: 100,
    maxQrFileMb: 50,
    maxQrStoragePerUserMb: 500,
  });
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [toolConfigs, setToolConfigs] = useState<Record<string, ToolOverrideConfig>>({});
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Apply .dark class to <html> element
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('rikzen-theme', theme);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', theme === 'dark' ? '#0B0C0E' : '#FAFAF8');
    }
  }, [theme]);

  // Sync saved preferences when profile loads
  useEffect(() => {
    if (profile?.theme === 'dark' || profile?.theme === 'light') {
      setThemeState(profile.theme);
    }
    if (profile?.language === 'en' || profile?.language === 'hi' || profile?.language === 'hinglish') {
      setLanguageState(profile.language);
      localStorage.setItem('rikzen-lang', profile.language);
    }
  }, [profile]);

  const refreshPublicConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/public/config');
      if (res.ok) {
        const data = await res.json();
        if (data.capabilities) setCapabilities(data.capabilities);
        if (Array.isArray(data.announcements)) setAnnouncements(data.announcements);
        if (data.toolConfigs) setToolConfigs(data.toolConfigs);
      }
    } catch {
      // Retain defaults
    }
  }, []);

  useEffect(() => {
    void refreshPublicConfig();
  }, [refreshPublicConfig]);

  const setTheme = useCallback(
    (next: 'light' | 'dark') => {
      setThemeState(next);
      void updateUserPreferences({ theme: next });
    },
    [updateUserPreferences]
  );

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const setLanguage = useCallback(
    (lang: LanguageCode) => {
      setLanguageState(lang);
      localStorage.setItem('rikzen-lang', lang);
      void updateUserPreferences({ language: lang });
    },
    [updateUserPreferences]
  );

  const notify = useCallback((text: string, type: 'info' | 'success' | 'error' = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-2), { id, type, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 4000);
  }, []);

  return (
    <AppContext.Provider
      value={{
        theme,
        toggleTheme,
        setTheme,
        language,
        setLanguage,
        t: getTranslations(language),
        capabilities,
        announcements,
        toolConfigs,
        refreshPublicConfig,
        notify,
      }}
    >
      {children}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="fixed bottom-20 md:bottom-6 right-4 z-50 flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)]"
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`rounded-2xl px-4 py-3 text-sm font-medium shadow-lg border backdrop-blur-md transition-all ${
                toast.type === 'error'
                  ? 'bg-red-50/95 dark:bg-red-950/90 text-red-900 dark:text-red-100 border-red-200 dark:border-red-800'
                  : toast.type === 'success'
                  ? 'bg-emerald-50/95 dark:bg-emerald-950/90 text-emerald-900 dark:text-emerald-100 border-emerald-200 dark:border-emerald-800'
                  : 'bg-white/95 dark:bg-[#17191E]/95 text-[#111214] dark:text-[#F4F4F0] border-[#E5E5E0] dark:border-[#262932]'
              }`}
            >
              {toast.text}
            </div>
          ))}
        </div>
      )}
    </AppContext.Provider>
  );
};

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
