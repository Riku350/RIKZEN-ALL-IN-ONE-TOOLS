import { ToolCategory } from './toolRegistry';

export const CATEGORY_ICON_STYLES: Record<ToolCategory, string> = {
  image:
    'bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-500/20 group-hover:bg-amber-600 group-hover:text-white dark:group-hover:bg-[#D4AF37] dark:group-hover:text-[#0B0C0E]',
  pdf:
    'bg-rose-500/10 text-rose-800 dark:text-rose-300 border border-rose-500/20 group-hover:bg-rose-700 group-hover:text-white dark:group-hover:bg-[#D4AF37] dark:group-hover:text-[#0B0C0E]',
  document:
    'bg-indigo-500/10 text-indigo-800 dark:text-indigo-300 border border-indigo-500/20 group-hover:bg-indigo-700 group-hover:text-white dark:group-hover:bg-[#D4AF37] dark:group-hover:text-[#0B0C0E]',
  student:
    'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-500/20 group-hover:bg-emerald-700 group-hover:text-white dark:group-hover:bg-[#D4AF37] dark:group-hover:text-[#0B0C0E]',
  utility:
    'bg-stone-500/10 text-stone-800 dark:text-stone-300 border border-stone-500/20 group-hover:bg-[#111214] group-hover:text-white dark:group-hover:bg-[#D4AF37] dark:group-hover:text-[#0B0C0E]',
};

export const CATEGORY_STATIC_ICON_STYLES: Record<ToolCategory, string> = {
  image: 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-500/20',
  pdf: 'bg-rose-500/10 text-rose-800 dark:text-rose-300 border border-rose-500/20',
  document: 'bg-indigo-500/10 text-indigo-800 dark:text-indigo-300 border border-indigo-500/20',
  student: 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-500/20',
  utility: 'bg-stone-500/10 text-stone-800 dark:text-stone-300 border border-stone-500/20',
};
