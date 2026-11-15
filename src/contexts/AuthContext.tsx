import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  OperationType,
  auth,
  db,
  googleAuthProvider,
  handleFirestoreError,
  verifyFirestoreConnection,
} from '../lib/firebase';
import { LanguageCode } from '../lib/i18n';
import { trackAnalyticsEvent } from '../lib/formatters';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: 'user' | 'admin';
  theme: 'light' | 'dark' | 'system';
  language: LanguageCode;
  createdAt?: Date | null;
}

export interface UserFileRecord {
  id: string;
  userId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  originalSizeBytes?: number;
  toolId: string;
  category: string;
  serverFileId?: string;
  expiresAt?: Date | null;
  createdAt?: Date | null;
}

export interface ToolHistoryRecord {
  id: string;
  userId: string;
  toolId: string;
  toolName: string;
  category: string;
  fileName?: string;
  inputSizeBytes?: number;
  outputSizeBytes?: number;
  status: 'completed' | 'failed';
  createdAt?: Date | null;
}

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  authError: string | null;
  isSigningIn: boolean;
  isAdmin: boolean;
  favorites: string[];
  files: UserFileRecord[];
  history: ToolHistoryRecord[];
  signInWithGoogle: () => Promise<boolean>;
  logout: () => Promise<void>;
  getToken: () => Promise<string | null>;
  toggleFavorite: (toolId: string, category: string) => Promise<void>;
  deleteUserFile: (fileId: string) => Promise<void>;
  renameUserFile: (fileId: string, fileName: string) => Promise<void>;
  clearUserHistory: () => Promise<void>;
  updateUserPreferences: (prefs: { theme?: 'light' | 'dark'; language?: LanguageCode }) => Promise<void>;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function toDate(val: unknown): Date | null {
  if (!val) return null;
  if (val instanceof Timestamp) return val.toDate();
  if (val instanceof Date) return val;
  return null;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [files, setFiles] = useState<UserFileRecord[]>([]);
  const [history, setHistory] = useState<ToolHistoryRecord[]>([]);

  useEffect(() => {
    void verifyFirestoreConnection();
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (!firebaseUser) {
        setProfile(null);
        setIsAdmin(false);
        setFavorites([]);
        setFiles([]);
        setHistory([]);
        setLoading(false);
        return;
      }

      try {
        const userRef = doc(db, 'users', firebaseUser.uid);
        const snap = await getDoc(userRef);

        if (!snap.exists()) {
          const newProfile = {
            uid: firebaseUser.uid,
            email: firebaseUser.email || '',
            displayName: firebaseUser.displayName || 'RIKZEN User',
            photoURL: firebaseUser.photoURL || '',
            role: 'user' as const,
            theme: (localStorage.getItem('rikzen-theme') === 'dark' ? 'dark' : 'light') as 'light' | 'dark',
            language: ((localStorage.getItem('rikzen-lang') as LanguageCode) || 'en'),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          await setDoc(userRef, newProfile);
          setProfile({
            ...newProfile,
            createdAt: new Date(),
          });
        } else {
          const data = snap.data();
          setProfile({
            uid: data.uid,
            email: data.email,
            displayName: data.displayName || firebaseUser.displayName || '',
            photoURL: data.photoURL || firebaseUser.photoURL || '',
            role: data.role || 'user',
            theme: data.theme || 'light',
            language: data.language || 'en',
            createdAt: toDate(data.createdAt),
          });
        }

        // Check admin status securely from backend RBAC endpoint
        const token = await firebaseUser.getIdToken();
        const cfgRes = await fetch('/api/public/config', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cfgRes.ok) {
          const cfg = await cfgRes.json();
          setIsAdmin(Boolean(cfg.isAdmin));
        }
      } catch (err) {
        console.error('Error syncing user profile:', err);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // Attach real-time Firestore listeners only when authenticated
  useEffect(() => {
    if (!user) return;

    const favQuery = query(collection(db, 'favorites'), where('userId', '==', user.uid));
    const unsubFav = onSnapshot(
      favQuery,
      (snap) => {
        setFavorites(snap.docs.map((d) => String(d.data().toolId)));
      },
      (err) => {
        console.error('Favorites listener error:', err);
      }
    );

    const filesQuery = query(
      collection(db, 'files'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(100)
    );
    const unsubFiles = onSnapshot(
      filesQuery,
      (snap) => {
        setFiles(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              userId: data.userId,
              fileName: data.fileName,
              mimeType: data.mimeType,
              sizeBytes: Number(data.sizeBytes || 0),
              originalSizeBytes: data.originalSizeBytes ? Number(data.originalSizeBytes) : undefined,
              toolId: data.toolId,
              category: data.category,
              serverFileId: data.serverFileId,
              expiresAt: toDate(data.expiresAt),
              createdAt: toDate(data.createdAt),
            };
          })
        );
      },
      (err) => {
        console.error('Files listener error:', err);
      }
    );

    const histQuery = query(
      collection(db, 'tool_history'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(100)
    );
    const unsubHist = onSnapshot(
      histQuery,
      (snap) => {
        setHistory(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              userId: data.userId,
              toolId: data.toolId,
              toolName: data.toolName,
              category: data.category,
              fileName: data.fileName,
              inputSizeBytes: data.inputSizeBytes ? Number(data.inputSizeBytes) : undefined,
              outputSizeBytes: data.outputSizeBytes ? Number(data.outputSizeBytes) : undefined,
              status: data.status === 'failed' ? 'failed' : 'completed',
              createdAt: toDate(data.createdAt),
            };
          })
        );
      },
      (err) => {
        console.error('History listener error:', err);
      }
    );

    return () => {
      unsubFav();
      unsubFiles();
      unsubHist();
    };
  }, [user]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    setIsSigningIn(true);
    try {
      await signInWithPopup(auth, googleAuthProvider);
      return true;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/popup-blocked') {
        setAuthError('Popup was blocked by your browser. Please allow popups to sign in with Google.');
      } else if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setAuthError('Sign-in was cancelled. Click Continue with Google when ready.');
      } else {
        setAuthError('Could not complete Google Sign-In. Please try again.');
      }
      return false;
    } finally {
      setIsSigningIn(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
  }, []);

  const getToken = useCallback(async () => {
    if (!auth.currentUser) return null;
    return await auth.currentUser.getIdToken();
  }, []);

  const toggleFavorite = useCallback(
    async (toolId: string, category: string) => {
      if (!user) return;
      const favId = `${user.uid}_${toolId}`;
      const ref = doc(db, 'favorites', favId);
      const isFav = favorites.includes(toolId);
      try {
        if (isFav) {
          await deleteDoc(ref);
        } else {
          await setDoc(ref, {
            userId: user.uid,
            toolId,
            createdAt: serverTimestamp(),
          });
          void trackAnalyticsEvent('favorite_added', toolId, category);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `favorites/${favId}`);
      }
    },
    [user, favorites]
  );

  const deleteUserFile = useCallback(
    async (fileId: string) => {
      const token = await getToken();
      if (!token) throw new Error('Authentication required.');
      const res = await fetch(`/api/files/${encodeURIComponent(fileId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not delete file.');
      }
    },
    [getToken]
  );

  const renameUserFile = useCallback(
    async (fileId: string, fileName: string) => {
      const token = await getToken();
      if (!token) throw new Error('Authentication required.');
      const res = await fetch(`/api/files/${encodeURIComponent(fileId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ fileName }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not rename file.');
      }
      setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, fileName } : f)));
    },
    [getToken]
  );

  const clearUserHistory = useCallback(async () => {
    const token = await getToken();
    if (!token) throw new Error('Authentication required.');
    const res = await fetch('/api/history/clear', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error('Could not clear history.');
    }
  }, [getToken]);

  const updateUserPreferences = useCallback(
    async (prefs: { theme?: 'light' | 'dark'; language?: LanguageCode }) => {
      if (!user) return;
      try {
        const userRef = doc(db, 'users', user.uid);
        await updateDoc(userRef, {
          ...prefs,
          updatedAt: serverTimestamp(),
        });
        setProfile((prev) => (prev ? { ...prev, ...prefs } : prev));
      } catch (err) {
        console.error('Could not persist preferences to profile:', err);
      }
    },
    [user]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        authError,
        isSigningIn,
        isAdmin,
        favorites,
        files,
        history,
        signInWithGoogle,
        logout,
        getToken,
        toggleFavorite,
        deleteUserFile,
        renameUserFile,
        clearUserHistory,
        updateUserPreferences,
        clearAuthError: () => setAuthError(null),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
