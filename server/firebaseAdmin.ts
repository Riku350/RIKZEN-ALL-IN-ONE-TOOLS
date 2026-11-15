import { Request, Response, NextFunction } from 'express';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };

const app = getApps().length
  ? getApps()[0]
  : initializeApp({
      projectId: firebaseConfig.projectId,
    });

export const adminAuth = getAuth(app);
export const adminDb = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
}

export function getAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS || 'gungaming05@gmail.com';
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function isAdminUser(user?: DecodedIdToken): Promise<boolean> {
  if (!user || !user.email_verified) return false;
  const email = (user.email || '').toLowerCase();
  if (email && getAdminEmails().includes(email)) {
    return true;
  }
  try {
    const adminDoc = await adminDb.collection('admins').doc(user.uid).get();
    return adminDoc.exists;
  } catch {
    return false;
  }
}

export async function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      try {
        req.user = await adminAuth.verifyIdToken(token);
      } catch {
        // Invalid or expired optional token; proceed unauthenticated
      }
    }
  }
  next();
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Please sign in with Google.' });
    return;
  }
  const token = authHeader.slice(7).trim();
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Your session expired. Please sign in again.' });
  }
}

export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const allowed = await isAdminUser(req.user);
  if (!allowed) {
    res.status(403).json({ error: 'Administrator access required.' });
    return;
  }
  next();
}
