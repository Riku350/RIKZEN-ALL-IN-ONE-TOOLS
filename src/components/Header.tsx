import React from 'react';
import { Moon, Search, Shield, Sun, User as UserIcon } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { useAuth } from '../contexts/AuthContext';
import { RikzenLogo } from './RikzenLogo';
import { PWAInstallButton } from './PWAInstallButton';

interface HeaderProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  onOpenSearch: () => void;
  onOpenAuthModal: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentPath,
  onNavigate,
  onOpenSearch,
  onOpenAuthModal,
}) => {
  const { theme, toggleTheme, t } = useApp();
  const { user, profile, isAdmin } = useAuth();

  const navItems = [
    { path: '/', label: t.navHome },
    { path: '/tools', label: t.navTools },
    { path: '/qr-codes', label: 'My QR' },
    { path: '/files', label: t.navFiles },
    { path: '/history', label: t.navHistory },
    { path: '/favorites', label: t.navSaved },
  ];

  const isActive = (path: string) =>
    path === '/' ? currentPath === '/' : currentPath.startsWith(path);

  return (
    <header className="sticky top-0 z-30 h-14 md:h-16 border-b border-[#E2DED4] dark:border-[#1E222C] bg-[#F4F1EA]/90 dark:bg-[#090B0E]/90 backdrop-blur-md">
      <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-6">
        {/* Brand */}
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            onNavigate('/');
          }}
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] rounded-lg"
          aria-label="RIKZEN Home"
        >
          <RikzenLogo size="md" />
        </a>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-6" aria-label="Primary">
          {navItems.map((item) => (
            <a
              key={item.path}
              href={item.path}
              onClick={(e) => {
                e.preventDefault();
                onNavigate(item.path);
              }}
              className={`text-sm font-semibold transition-colors whitespace-nowrap shrink-0 py-1.5 border-b-2 ${
                isActive(item.path)
                  ? 'text-[#111214] dark:text-[#F4F4F0] border-[#C9A227]'
                  : 'text-[#5A5D65] dark:text-[#9CA0AA] border-transparent hover:text-[#111214] dark:hover:text-[#F4F4F0]'
              }`}
            >
              {item.label}
            </a>
          ))}
          {isAdmin && (
            <a
              href="/admin"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('/admin');
              }}
              className={`text-sm font-semibold transition-colors whitespace-nowrap shrink-0 py-1.5 border-b-2 inline-flex items-center gap-1.5 ${
                isActive('/admin')
                  ? 'text-[#111214] dark:text-[#F4F4F0] border-[#C9A227]'
                  : 'text-[#5A5D65] dark:text-[#9CA0AA] border-transparent hover:text-[#111214] dark:hover:text-[#F4F4F0]'
              }`}
            >
              <Shield className="w-3.5 h-3.5 text-[#C9A227]" />
              <span>Admin</span>
            </a>
          )}
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <PWAInstallButton variant="compact" />

          <button
            type="button"
            onClick={onOpenSearch}
            aria-label="Search tools"
            className="min-h-[40px] min-w-[40px] md:px-3.5 rounded-xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] text-[#5A5D65] dark:text-[#9CA0AA] hover:text-[#111214] dark:hover:text-[#F4F4F0] hover:border-[#C9A227] flex items-center justify-center gap-2 text-xs font-semibold transition-all active:scale-[0.98] cursor-pointer"
          >
            <Search className="w-4 h-4 shrink-0 text-[#C9A227]" />
            <span className="hidden lg:inline whitespace-nowrap">Search</span>
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="min-h-[40px] min-w-[40px] rounded-xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] text-[#5A5D65] dark:text-[#9CA0AA] hover:text-[#111214] dark:hover:text-[#F4F4F0] hover:border-[#C9A227] flex items-center justify-center transition-all active:scale-[0.98] cursor-pointer"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4 text-[#D4AF37]" /> : <Moon className="w-4 h-4" />}
          </button>

          {user ? (
            <button
              type="button"
              onClick={() => onNavigate('/profile')}
              aria-label="Open profile"
              className="min-h-[40px] flex items-center gap-2 rounded-xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] pl-1.5 pr-3 py-1 hover:border-[#C9A227] transition-all active:scale-[0.98] cursor-pointer shrink-0"
            >
              {profile?.photoURL || user.photoURL ? (
                <img
                  src={profile?.photoURL || user.photoURL || ''}
                  alt={profile?.displayName || 'User'}
                  referrerPolicy="no-referrer"
                  className="w-7 h-7 rounded-lg object-cover"
                />
              ) : (
                <span className="w-7 h-7 rounded-lg bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] flex items-center justify-center text-xs font-bold">
                  {(profile?.displayName || user.email || 'R').slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="hidden sm:inline text-xs font-semibold text-[#111214] dark:text-[#F4F4F0] max-w-[96px] truncate">
                {profile?.displayName?.split(' ')[0] || t.navProfile}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenAuthModal}
              className="min-h-[40px] px-3.5 py-2 rounded-xl bg-gradient-to-b from-[#1A1C21] to-[#0F1014] dark:from-[#E0BC46] dark:to-[#C59D24] text-white dark:text-[#0B0C0E] text-xs font-semibold hover:opacity-95 transition-all active:scale-[0.98] flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer shadow-sm"
            >
              <UserIcon className="w-3.5 h-3.5" />
              <span>Sign in</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
