import React from 'react';

export const RikzenLogo: React.FC<{ size?: 'sm' | 'md' }> = ({ size = 'md' }) => {
  const iconSize = size === 'sm' ? 'w-7 h-7' : 'w-8 h-8';
  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0 select-none">
      <svg
        viewBox="0 0 40 40"
        fill="none"
        className={`${iconSize} shrink-0`}
        aria-hidden="true"
      >
        <rect width="40" height="40" rx="11" className="fill-[#111214] dark:fill-[#1A1C22]" />
        <rect
          x="1"
          y="1"
          width="38"
          height="38"
          rx="10"
          className="stroke-[#C9A227]/45"
          strokeWidth="1.2"
        />
        <path
          d="M11.5 10.5H21.2C25.4 10.5 28.8 13.9 28.8 18.1C28.8 21.2 26.9 23.9 24.1 25.1L29.2 30.5H23.7L19.1 25.5H15.5V30.5H11.5V10.5ZM15.5 14.1V21.9H21C23.1 21.9 24.8 20.2 24.8 18.1C24.8 16 23.1 14.1 21 14.1H15.5Z"
          className="fill-[#FAFAF8]"
        />
        <circle cx="27.5" cy="11.8" r="2.2" fill="#D4AF37" />
      </svg>
      <span className="font-display text-lg font-extrabold tracking-tight text-[#111214] dark:text-[#F4F4F0]">
        RIKZEN
      </span>
    </span>
  );
};
