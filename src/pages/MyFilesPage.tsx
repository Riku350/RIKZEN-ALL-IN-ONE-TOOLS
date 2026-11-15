import React, { useState } from 'react';
import {
  Download,
  Edit3,
  FileText,
  FolderOpen,
  LayoutGrid,
  List,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { GoogleAuthCard } from '../components/GoogleAuthCard';
import { formatBytes, formatRelativeDate } from '../lib/formatters';
import { downloadFileSafely } from '../lib/downloadClient';

export const MyFilesPage: React.FC<{ onNavigate: (path: string) => void }> = ({
  onNavigate,
}) => {
  const { user, loading, files, getToken, deleteUserFile, renameUserFile } = useAuth();
  const { t, notify } = useApp();

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-4">
        <div className="h-8 w-44 rounded-xl bg-[#EAEAE4] dark:bg-[#1B1E26] animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-36 rounded-3xl bg-[#EAEAE4] dark:bg-[#1B1E26] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 pb-24">
        <GoogleAuthCard
          title="My Files"
          subtitle="Sign in with Google to view, download, rename, or delete your recently processed files."
        />
      </div>
    );
  }

  const handleDownload = async (serverFileId: string | undefined, fileName: string) => {
    if (!serverFileId) {
      notify('This file was processed locally in your browser and is not stored on the server.', 'info');
      return;
    }
    try {
      const token = await getToken();
      await downloadFileSafely({
        url: `/api/files/${encodeURIComponent(serverFileId)}/download`,
        fileName,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
    } catch (err) {
      notify(err instanceof Error ? err.message : 'This file has expired.', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteUserFile(id);
      notify('File deleted.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not delete file.', 'error');
    }
  };

  const submitRename = async (id: string) => {
    if (!renameText.trim()) return;
    try {
      await renameUserFile(id, renameText.trim());
      setRenamingId(null);
      notify('File renamed.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Rename failed.', 'error');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-6 pb-24 md:pb-16">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#111214] dark:text-[#F4F4F0]">
            My Files
          </h1>
          <p className="text-xs sm:text-sm text-[#5A5D65] dark:text-[#9CA0AA] mt-1">
            Temporary processed files auto-expire securely after 30 minutes.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B]">
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            aria-label="Grid view"
            className={`min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center cursor-pointer ${
              viewMode === 'grid'
                ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E]'
                : 'text-[#6B707B]'
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            aria-label="List view"
            className={`min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center cursor-pointer ${
              viewMode === 'list'
                ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E]'
                : 'text-[#6B707B]'
            }`}
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {files.length === 0 ? (
        <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-12 text-center space-y-4">
          <span className="mx-auto w-14 h-14 rounded-2xl bg-[#F4F2EC] dark:bg-[#1C1F26] text-[#C9A227] flex items-center justify-center">
            <FolderOpen className="w-6 h-6" />
          </span>
          <h2 className="text-lg font-bold">{t.noFilesTitle}</h2>
          <p className="text-sm text-[#5A5D65] dark:text-[#9CA0AA]">{t.noFilesDesc}</p>
          <button
            type="button"
            onClick={() => onNavigate('/tools')}
            className="min-h-[44px] px-6 rounded-xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-sm font-semibold cursor-pointer"
          >
            {t.exploreTools}
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {files.map((file) => {
            const expired = file.expiresAt ? file.expiresAt.getTime() < Date.now() : false;
            return (
              <div
                key={file.id}
                className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] p-5 flex flex-col justify-between gap-4"
              >
                <div className="flex items-start gap-3">
                  <span className="w-11 h-11 rounded-2xl bg-[#F4F2EC] dark:bg-[#1C1F26] text-[#111214] dark:text-[#D4AF37] flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    {renamingId === file.id ? (
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={renameText}
                          onChange={(e) => setRenameText(e.target.value)}
                          className="w-full min-h-[34px] rounded-lg border border-[#C9A227] bg-transparent px-2 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => void submitRename(file.id)}
                          className="px-2.5 rounded-lg bg-[#C9A227] text-[#0B0C0E] text-xs font-semibold cursor-pointer"
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <p className="text-sm font-bold truncate">{file.fileName}</p>
                    )}
                    <p className="text-xs font-mono tabular-nums text-[#6B707B] dark:text-[#9CA0AA] mt-1">
                      {formatBytes(file.sizeBytes)} · {formatRelativeDate(file.createdAt)}
                      {expired ? ' · Expired' : ''}
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t border-[#F0F0EC] dark:border-[#1E2128] flex items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={expired}
                    onClick={() => void handleDownload(file.serverFileId, file.fileName)}
                    className="min-h-[38px] px-3.5 rounded-xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{t.download}</span>
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingId(file.id);
                        setRenameText(file.fileName);
                      }}
                      aria-label="Rename file"
                      className="min-h-[38px] min-w-[38px] rounded-xl text-[#6B707B] hover:text-[#111214] dark:hover:text-[#F4F4F0] flex items-center justify-center cursor-pointer"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(file.id)}
                      aria-label="Delete file"
                      className="min-h-[38px] min-w-[38px] rounded-xl text-[#6B707B] hover:text-red-600 flex items-center justify-center cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rikzen-card rounded-3xl border border-[#E2DED4] dark:border-[#232833] bg-white dark:bg-[#12151B] divide-y divide-[#ECE8DE] dark:divide-[#1E2128]">
          {files.map((file) => {
            const expired = file.expiresAt ? file.expiresAt.getTime() < Date.now() : false;
            return (
              <div key={file.id} className="p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="w-5 h-5 text-[#C9A227] shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{file.fileName}</p>
                    <p className="text-xs font-mono tabular-nums text-[#6B707B]">
                      {formatBytes(file.sizeBytes)} · {formatRelativeDate(file.createdAt)}
                      {expired ? ' · Expired' : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={expired}
                    onClick={() => void handleDownload(file.serverFileId, file.fileName)}
                    className="min-h-[38px] px-3.5 rounded-xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-xs font-semibold disabled:opacity-40 cursor-pointer"
                  >
                    {t.download}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(file.id)}
                    aria-label="Delete"
                    className="min-h-[38px] min-w-[38px] rounded-xl text-[#6B707B] hover:text-red-600 flex items-center justify-center cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
