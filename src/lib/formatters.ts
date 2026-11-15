import { auth } from './firebase';

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, idx);
  return `${val >= 100 || idx === 0 ? Math.round(val) : val.toFixed(val < 10 ? 2 : 1)} ${units[idx]}`;
}

export function formatRelativeDate(dateInput: Date | string | number | null | undefined): string {
  if (!dateInput) return 'Just now';
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(date.getTime())) return 'Just now';
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export type AnalyticsEventName =
  | 'tool_opened'
  | 'file_uploaded'
  | 'processing_started'
  | 'processing_completed'
  | 'download_clicked'
  | 'favorite_added';

export async function trackAnalyticsEvent(
  event: AnalyticsEventName,
  toolId: string,
  category: string
) {
  try {
    await fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, toolId, category }),
    });
  } catch {
    // Non-blocking analytics
  }
}

export async function logClientToolExecution(params: {
  toolId: string;
  toolName: string;
  category: string;
  fileName: string;
  inputSizeBytes?: number;
  outputSizeBytes?: number;
}) {
  try {
    const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
    await fetch('/api/tools/client-log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(params),
    });
  } catch {
    // Non-blocking log
  }
}
