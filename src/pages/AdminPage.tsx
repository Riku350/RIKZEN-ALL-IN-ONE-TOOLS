import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Megaphone, ShieldAlert, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { formatBytes } from '../lib/formatters';
import { TOOL_REGISTRY } from '../lib/toolRegistry';

interface AdminOverviewData {
  stats: {
    totalUsers: number;
    activeUsers7d: number;
    totalOperations: number;
    errorCount: number;
    tempFilesActive: number;
    tempStorageBytes: number;
    recordedFileBytes: number;
  };
  popularTools: { toolId: string; toolName: string; count: number; errors: number }[];
  users: {
    uid: string;
    email: string;
    displayName: string;
    role: string;
    language: string;
    createdAt: string | null;
  }[];
  announcements: {
    id: string;
    title: string;
    message: string;
    active: boolean;
    createdAt: string | null;
  }[];
  toolConfigs: { toolId: string; enabled: boolean; maxFileSizeMb: number }[];
}

export const AdminPage: React.FC = () => {
  const { user, loading, isAdmin, getToken } = useAuth();
  const { notify, refreshPublicConfig } = useApp();

  const [data, setData] = useState<AdminOverviewData | null>(null);
  const [fetching, setFetching] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [annTitle, setAnnTitle] = useState('');
  const [annMsg, setAnnMsg] = useState('');
  const [toolFilter, setToolFilter] = useState('');

  const loadOverview = useCallback(async () => {
    setFetching(true);
    setErr(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Authentication required.');
      const res = await fetch('/api/admin/overview', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Access denied.');
      setData(json);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load admin console.');
    } finally {
      setFetching(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (user && isAdmin) {
      void loadOverview();
    } else if (!loading) {
      setFetching(false);
    }
  }, [user, isAdmin, loading, loadOverview]);

  if (loading || fetching) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16 flex items-center justify-center gap-3 text-sm text-[#5A5D65]">
        <Loader2 className="w-5 h-5 animate-spin text-[#C9A227]" />
        <span>Loading Admin Console...</span>
      </div>
    );
  }

  if (!user || !isAdmin) {
    return (
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-16 text-center space-y-3">
        <span className="mx-auto w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-950/40 text-red-600 flex items-center justify-center">
          <ShieldAlert className="w-6 h-6" />
        </span>
        <h1 className="text-xl font-bold">Access Restricted</h1>
        <p className="text-sm text-[#5A5D65] dark:text-[#9CA0AA]">
          This route is protected by role-based access control and requires a verified administrator account.
        </p>
      </div>
    );
  }

  if (err || !data) {
    return (
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-16 text-center space-y-4">
        <p className="text-sm text-red-600">{err || 'Could not load dashboard.'}</p>
        <button
          type="button"
          onClick={() => void loadOverview()}
          className="min-h-[42px] px-5 rounded-xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-xs font-semibold cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  const toggleTool = async (toolId: string, enabled: boolean, maxFileSizeMb: number) => {
    try {
      const token = await getToken();
      const res = await fetch(`/api/admin/tools/${encodeURIComponent(toolId)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ enabled, maxFileSizeMb }),
      });
      if (!res.ok) throw new Error();
      notify(`Updated ${toolId}.`, 'success');
      await Promise.all([loadOverview(), refreshPublicConfig()]);
    } catch {
      notify('Could not update tool settings.', 'error');
    }
  };

  const publishAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!annTitle.trim() || !annMsg.trim()) return;
    try {
      const token = await getToken();
      const res = await fetch('/api/admin/announcements', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title: annTitle.trim(), message: annMsg.trim() }),
      });
      if (!res.ok) throw new Error();
      setAnnTitle('');
      setAnnMsg('');
      notify('Announcement published.', 'success');
      await Promise.all([loadOverview(), refreshPublicConfig()]);
    } catch {
      notify('Could not publish announcement.', 'error');
    }
  };

  const deleteAnnouncement = async (id: string) => {
    try {
      const token = await getToken();
      await fetch(`/api/admin/announcements/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      await Promise.all([loadOverview(), refreshPublicConfig()]);
    } catch {
      notify('Delete failed.', 'error');
    }
  };

  const cfgMap = new Map(data.toolConfigs.map((c) => [c.toolId, c]));
  const filteredTools = TOOL_REGISTRY.filter((tool) =>
    tool.name.toLowerCase().includes(toolFilter.trim().toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-8 pb-24 md:pb-16">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold">Admin Console</h1>
        <p className="text-sm text-[#5A5D65] dark:text-[#9CA0AA] mt-1">
          Live usage metrics, tool limits, user roles, and announcements
        </p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: 'Total Users', value: data.stats.totalUsers },
          { label: 'Active Users (7d)', value: data.stats.activeUsers7d },
          { label: 'Tool Operations', value: data.stats.totalOperations },
          { label: 'Errors Logged', value: data.stats.errorCount },
          {
            label: 'Temp Storage',
            value: formatBytes(data.stats.tempStorageBytes),
          },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-5"
          >
            <div className="text-xs text-[#6B707B] dark:text-[#9CA0AA]">{kpi.label}</div>
            <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-[#111214] dark:text-[#F4F4F0]">
              {kpi.value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Popular Tools */}
        <div className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-6 space-y-4">
          <h2 className="text-base font-bold">Popular Tools</h2>
          {data.popularTools.length === 0 ? (
            <p className="text-sm text-[#6B707B]">No operations recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {data.popularTools.map((pt) => (
                <div key={pt.toolId} className="flex items-center justify-between text-sm">
                  <span className="font-medium truncate">{pt.toolName}</span>
                  <span className="font-mono tabular-nums text-xs text-[#6B707B]">
                    {pt.count} runs · {pt.errors} errors
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Announcements */}
        <div className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-6 space-y-4">
          <div className="flex items-center gap-2 text-base font-bold">
            <Megaphone className="w-4 h-4 text-[#C9A227]" />
            <span>Announcements</span>
          </div>
          <form onSubmit={publishAnnouncement} className="space-y-2.5">
            <input
              type="text"
              value={annTitle}
              onChange={(e) => setAnnTitle(e.target.value)}
              placeholder="Announcement title"
              className="w-full min-h-[42px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-3.5 text-sm"
            />
            <input
              type="text"
              value={annMsg}
              onChange={(e) => setAnnMsg(e.target.value)}
              placeholder="Short banner message"
              className="w-full min-h-[42px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-3.5 text-sm"
            />
            <button
              type="submit"
              className="min-h-[42px] px-5 rounded-xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-xs font-semibold cursor-pointer"
            >
              Publish Banner
            </button>
          </form>

          <div className="divide-y divide-[#F0F0EC] dark:divide-[#1E2128] pt-2">
            {data.announcements.map((a) => (
              <div key={a.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <div className="font-bold truncate">{a.title}</div>
                  <div className="text-[#6B707B] truncate">{a.message}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void deleteAnnouncement(a.id)}
                  aria-label="Delete announcement"
                  className="p-2 text-[#6B707B] hover:text-red-600 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tool Limits & Toggles */}
      <div className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold">Manage Tools & Size Limits</h2>
          <input
            type="search"
            value={toolFilter}
            onChange={(e) => setToolFilter(e.target.value)}
            placeholder="Filter tools..."
            className="min-h-[40px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-3.5 text-xs"
          />
        </div>
        <div className="divide-y divide-[#F0F0EC] dark:divide-[#1E2128] max-h-96 overflow-y-auto">
          {filteredTools.map((tool) => {
            const cfg = cfgMap.get(tool.id);
            const enabled = cfg ? cfg.enabled : true;
            const maxMb = cfg ? cfg.maxFileSizeMb : tool.maxSizeMb || 25;
            return (
              <div key={tool.id} className="py-3 flex items-center justify-between gap-4 text-sm">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{tool.name}</div>
                  <div className="text-xs text-[#6B707B]">
                    {tool.category} · Max {maxMb} MB
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void toggleTool(tool.id, !enabled, maxMb)}
                  className={`min-h-[36px] px-4 rounded-xl text-xs font-semibold border cursor-pointer ${
                    enabled
                      ? 'border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
                      : 'border-red-300 dark:border-red-800 text-red-600 dark:text-red-400'
                  }`}
                >
                  {enabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Users list */}
      <div className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-6 space-y-4">
        <h2 className="text-base font-bold">Users ({data.users.length})</h2>
        <div className="divide-y divide-[#F0F0EC] dark:divide-[#1E2128] max-h-72 overflow-y-auto">
          {data.users.map((u) => (
            <div key={u.uid} className="py-3 flex items-center justify-between gap-4 text-sm">
              <div className="min-w-0">
                <div className="font-semibold truncate">{u.displayName || 'User'}</div>
                <div className="text-xs text-[#6B707B] truncate">{u.email}</div>
              </div>
              <span className="text-xs font-mono text-[#C9A227] uppercase shrink-0">
                {u.role}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
