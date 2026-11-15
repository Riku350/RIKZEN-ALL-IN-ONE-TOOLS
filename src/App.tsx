import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { AuthProvider } from './contexts/AuthContext';
import { AppProvider } from './contexts/AppContext';
import { Header } from './components/Header';
import { MobileBottomNav } from './components/MobileBottomNav';
import { Footer } from './components/Footer';
import { SearchModal } from './components/SearchModal';
import { GoogleAuthCard } from './components/GoogleAuthCard';
import { OfflineIndicator } from './components/OfflineIndicator';

const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })));
const ToolsCatalogPage = lazy(() =>
  import('./pages/ToolsCatalogPage').then((m) => ({ default: m.ToolsCatalogPage }))
);
const ToolDetailPage = lazy(() =>
  import('./pages/ToolDetailPage').then((m) => ({ default: m.ToolDetailPage }))
);
const MyFilesPage = lazy(() =>
  import('./pages/MyFilesPage').then((m) => ({ default: m.MyFilesPage }))
);
const HistoryPage = lazy(() =>
  import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage }))
);
const FavoritesPage = lazy(() =>
  import('./pages/FavoritesPage').then((m) => ({ default: m.FavoritesPage }))
);
const ProfilePage = lazy(() =>
  import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage }))
);
const AdminPage = lazy(() =>
  import('./pages/AdminPage').then((m) => ({ default: m.AdminPage }))
);
const InfoPage = lazy(() =>
  import('./pages/InfoPage').then((m) => ({ default: m.InfoPage }))
);
const QrContentPage = lazy(() =>
  import('./pages/QrContentPage').then((m) => ({ default: m.QrContentPage }))
);
const MyQrCodesPage = lazy(() =>
  import('./pages/MyQrCodesPage').then((m) => ({ default: m.MyQrCodesPage }))
);

function AppRouter() {
  const [locationPath, setLocationPath] = useState(
    () => window.location.pathname + window.location.search
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  useEffect(() => {
    const onPopState = () => {
      setLocationPath(window.location.pathname + window.location.search);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const canonicalUrl = window.location.origin + window.location.pathname;
    let canonicalLink = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!canonicalLink) {
      canonicalLink = document.createElement('link');
      canonicalLink.rel = 'canonical';
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.href = canonicalUrl;
  }, [locationPath]);

  const navigate = useCallback((nextPath: string) => {
    window.history.pushState({}, '', nextPath);
    setLocationPath(nextPath);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const url = new URL(locationPath, 'https://rikzen.local');
  const pathname = url.pathname;
  const categoryParam = url.searchParams.get('category');

  const renderPage = () => {
    if (pathname === '/' || pathname === '') {
      return (
        <HomePage
          onNavigate={navigate}
          onOpenAuthModal={() => setAuthModalOpen(true)}
        />
      );
    }
    if (pathname === '/tools') {
      return (
        <ToolsCatalogPage
          initialCategory={categoryParam}
          onNavigate={navigate}
          onOpenAuthModal={() => setAuthModalOpen(true)}
        />
      );
    }
    if (pathname.startsWith('/tools/')) {
      const toolId = pathname.replace('/tools/', '').replace(/\/+$/, '');
      return (
        <ToolDetailPage
          toolId={toolId}
          onNavigate={navigate}
          onOpenAuthModal={() => setAuthModalOpen(true)}
        />
      );
    }
    if (pathname.startsWith('/q/')) {
      const shareId = pathname.replace('/q/', '').replace(/\/+$/, '');
      return <QrContentPage shareId={shareId} onNavigate={navigate} />;
    }
    if (pathname === '/qr-codes') return <MyQrCodesPage onNavigate={navigate} />;
    if (pathname === '/files') return <MyFilesPage onNavigate={navigate} />;
    if (pathname === '/history') return <HistoryPage onNavigate={navigate} />;
    if (pathname === '/favorites') return <FavoritesPage onNavigate={navigate} />;
    if (pathname === '/profile') return <ProfilePage onNavigate={navigate} />;
    if (pathname === '/admin') return <AdminPage />;
    if (
      pathname === '/privacy' ||
      pathname === '/terms' ||
      pathname === '/security' ||
      pathname === '/about' ||
      pathname === '/contact'
    ) {
      return (
        <InfoPage
          slug={pathname.slice(1) as 'privacy' | 'terms' | 'security' | 'about' | 'contact'}
          onNavigate={navigate}
        />
      );
    }
    return (
      <HomePage
        onNavigate={navigate}
        onOpenAuthModal={() => setAuthModalOpen(true)}
      />
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F4F1EA] dark:bg-[#090B0E] text-[#111214] dark:text-[#F4F4F0]">
      <Header
        currentPath={pathname}
        onNavigate={navigate}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenAuthModal={() => setAuthModalOpen(true)}
      />

      <main className="flex-1">
        <Suspense
          fallback={
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 space-y-4">
              <div className="h-10 w-64 rounded-2xl bg-[#EAEAE4] dark:bg-[#1B1E26] animate-pulse" />
              <div className="h-56 rounded-3xl bg-[#EAEAE4] dark:bg-[#1B1E26] animate-pulse" />
            </div>
          }
        >
          {renderPage()}
        </Suspense>
      </main>

      <Footer onNavigate={navigate} />

      <MobileBottomNav currentPath={pathname} onNavigate={navigate} />

      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectTool={navigate}
      />

      {authModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
          onClick={() => setAuthModalOpen(false)}
        >
          <div className="relative w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setAuthModalOpen(false)}
              aria-label="Close sign in dialog"
              className="absolute top-4 right-4 z-10 min-h-[36px] min-w-[36px] rounded-xl flex items-center justify-center text-[#6B707B] hover:text-[#111214] dark:hover:text-[#F4F4F0] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
            <GoogleAuthCard onSuccess={() => setAuthModalOpen(false)} />
          </div>
        </div>
      )}

      <OfflineIndicator />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <AppRouter />
      </AppProvider>
    </AuthProvider>
  );
}
