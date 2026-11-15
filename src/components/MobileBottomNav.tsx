import React from 'react';
import { FolderOpen, Home, Star, User, Wrench } from 'lucide-react';
import { useApp } from '../contexts/AppContext';

interface MobileBottomNavProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  currentPath,
  onNavigate,
}) => {
  const { t } = useApp();

  const tabs = [
    { path: '/', label: t.navHome, icon: Home },
    { path: '/tools', label: t.navTools, icon: Wrench },
    { path: '/files', label: t.navFiles, icon: FolderOpen },
    { path: '/favorites', label: t.navSaved, icon: Star },
    { path: '/profile', label: t.navProfile, icon: User },
  ];

  const isActive = (path: string) =>
    path === '/' ? currentPath === '/' : currentPath.startsWith(path);

  return (
    <nav
      aria-label="Mobile Navigation"
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-[#E2DED4] dark:border-[#1E222C] bg-[#F4F1EA]/95 dark:bg-[#090B0E]/95 backdrop-blur-md pb-safe"
    >
      <div className="grid grid-cols-5 h-16 items-center px-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(tab.path);
          return (
            <button
              key={tab.path}
              type="button"
              onClick={() => onNavigate(tab.path)}
              className={`relative min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-1 transition-all active:scale-95 cursor-pointer ${
                active
                  ? 'text-[#B88E1E] dark:text-[#D4AF37] bg-[#C9A227]/10'
                  : 'text-[#5A5D65] dark:text-[#9CA0AA]'
              }`}
            >
              {active && (
                <span className="absolute top-0.5 w-6 h-0.5 rounded-full bg-[#C9A227] dark:bg-[#D4AF37]" />
              )}
              <Icon className="w-5 h-5" />
              <span className="text-[11px] font-semibold tracking-tight whitespace-nowrap">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
