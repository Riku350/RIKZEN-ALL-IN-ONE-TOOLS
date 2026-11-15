import React from 'react';
import { RikzenLogo } from './RikzenLogo';
import { useApp } from '../contexts/AppContext';

export const Footer: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const { t } = useApp();

  const links = [
    { path: '/tools', label: 'Tools' },
    { path: '/privacy', label: 'Privacy' },
    { path: '/terms', label: 'Terms' },
    { path: '/contact', label: 'Contact' },
    { path: '/about', label: 'About' },
    { path: '/security', label: 'Security' },
  ];

  return (
    <footer className="border-t border-[#E5E5E0] dark:border-[#22252C] bg-white dark:bg-[#0F1115] pb-24 md:pb-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <RikzenLogo size="sm" />
            <span className="text-xs font-semibold tracking-wide text-[#5A5D65] dark:text-[#9CA0AA]">
              ALL-IN-ONE TOOLS
            </span>
          </div>
          <p className="mt-2 text-sm text-[#5A5D65] dark:text-[#9CA0AA]">{t.tagline}</p>
        </div>

        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2" aria-label="Footer">
          {links.map((link) => (
            <a
              key={link.path}
              href={link.path}
              onClick={(e) => {
                e.preventDefault();
                onNavigate(link.path);
              }}
              className="text-sm font-medium text-[#5A5D65] dark:text-[#9CA0AA] hover:text-[#111214] dark:hover:text-[#F4F4F0] transition-colors whitespace-nowrap"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <p className="text-xs text-[#6B707B] dark:text-[#8E939E]">
          © 2026 RIKZEN. All rights reserved.
        </p>
      </div>
    </footer>
  );
};
