import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({ prompt: 'select_account' });

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
} as const;

export type OperationTypeValue = (typeof OperationType)[keyof typeof OperationType];

export function handleFirestoreError(
  error: unknown,
  operationType: OperationTypeValue,
  path: string | null
): never {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function verifyFirestoreConnection() {
  try {
    await getDocFromServer(doc(db, 'announcements', '_healthcheck'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Firestore connection check: client appears offline.');
    }
  }
}
