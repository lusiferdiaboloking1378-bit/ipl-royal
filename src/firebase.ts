import { initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocFromServer,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

if (typeof window !== 'undefined') {
  void testConnection();
}

export interface UserCareerProfile {
  uid: string;
  displayName: string;
  email: string;
  favoriteFranchiseId: string;
  careerWins: number;
  careerMatches: number;
  careerPurse: number;
}

export interface LeaderboardEntry {
  uid: string;
  displayName: string;
  favoriteFranchiseId: string;
  careerWins: number;
  careerMatches: number;
  careerPurse: number;
}

function sanitizeDisplayName(raw: string | null | undefined, email: string | null | undefined): string {
  const candidate = (raw || email?.split('@')[0] || 'IPL Captain').trim();
  return candidate.slice(0, 60) || 'IPL Captain';
}

function sanitizeEmail(raw: string | null | undefined): string {
  const candidate = (raw || 'player@ipl.local').trim();
  return candidate.slice(0, 120);
}

function sanitizeFranchiseId(raw: string | null | undefined): string {
  const clean = (raw || 'MI').toUpperCase().replace(/[^A-Z]/g, '');
  return /^[A-Z]{2,4}$/.test(clean) ? clean : 'MI';
}

export async function loadUserProfile(user: User): Promise<UserCareerProfile | null> {
  const docPath = `users/${user.uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      uid: user.uid,
      displayName: sanitizeDisplayName(data.displayName, user.email),
      email: sanitizeEmail(data.email || user.email),
      favoriteFranchiseId: sanitizeFranchiseId(data.favoriteFranchiseId),
      careerWins: typeof data.careerWins === 'number' ? Math.max(0, Math.floor(data.careerWins)) : 0,
      careerMatches:
        typeof data.careerMatches === 'number' ? Math.max(0, Math.floor(data.careerMatches)) : 0,
      careerPurse: typeof data.careerPurse === 'number' ? Math.max(0, data.careerPurse) : 120.0,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, docPath);
  }
}

export async function saveUserProfile(
  user: User,
  updates: Partial<Omit<UserCareerProfile, 'uid' | 'email'>>
): Promise<void> {
  if (!user.emailVerified) {
    return;
  }

  const docPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);
  const leaderboardRef = doc(db, 'leaderboard', user.uid);

  const safeName = sanitizeDisplayName(
    updates.displayName ?? user.displayName,
    user.email
  );
  const safeEmail = sanitizeEmail(user.email);
  const safeFranchise = sanitizeFranchiseId(updates.favoriteFranchiseId);
  const safeWins = Math.max(0, Math.min(100000, Math.floor(updates.careerWins ?? 0)));
  const safeMatches = Math.max(
    safeWins,
    Math.min(100000, Math.floor(updates.careerMatches ?? 0))
  );
  const safePurse = Math.max(0, Math.min(10000, Number((updates.careerPurse ?? 120.0).toFixed(2))));

  try {
    const [existingUserSnap, existingLbSnap] = await Promise.all([
      getDoc(userRef),
      getDoc(leaderboardRef),
    ]);

    const batch = writeBatch(db);

    if (!existingUserSnap.exists()) {
      batch.set(userRef, {
        uid: user.uid,
        displayName: safeName,
        email: safeEmail,
        favoriteFranchiseId: safeFranchise,
        careerWins: safeWins,
        careerMatches: safeMatches,
        careerPurse: safePurse,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.update(userRef, {
        displayName: safeName,
        email: safeEmail,
        favoriteFranchiseId: safeFranchise,
        careerWins: safeWins,
        careerMatches: safeMatches,
        careerPurse: safePurse,
        updatedAt: serverTimestamp(),
      });
    }

    if (!existingLbSnap.exists()) {
      batch.set(leaderboardRef, {
        uid: user.uid,
        displayName: safeName,
        favoriteFranchiseId: safeFranchise,
        careerWins: safeWins,
        careerMatches: safeMatches,
        careerPurse: safePurse,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.update(leaderboardRef, {
        displayName: safeName,
        favoriteFranchiseId: safeFranchise,
        careerWins: safeWins,
        careerMatches: safeMatches,
        careerPurse: safePurse,
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, docPath);
  }
}

export async function syncLeaderboardFromProfile(
  user: User,
  profile: UserCareerProfile
): Promise<void> {
  if (!user.emailVerified) return;
  const lbPath = `leaderboard/${user.uid}`;
  const lbRef = doc(db, 'leaderboard', user.uid);
  try {
    const lbSnap = await getDoc(lbRef);
    const safeWins = Math.max(0, Math.min(100000, Math.floor(profile.careerWins)));
    const safeMatches = Math.max(safeWins, Math.min(100000, Math.floor(profile.careerMatches)));
    const safePurse = Math.max(0, Math.min(10000, Number(profile.careerPurse.toFixed(2))));
    const batch = writeBatch(db);
    if (!lbSnap.exists()) {
      batch.set(lbRef, {
        uid: user.uid,
        displayName: sanitizeDisplayName(profile.displayName, user.email),
        favoriteFranchiseId: sanitizeFranchiseId(profile.favoriteFranchiseId),
        careerWins: safeWins,
        careerMatches: safeMatches,
        careerPurse: safePurse,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, lbPath);
  }
}

export function subscribeGlobalLeaderboard(
  onUpdate: (entries: LeaderboardEntry[]) => void,
  onError?: (err: unknown) => void,
  maxResults = 25
): () => void {
  if (!auth.currentUser) {
    return () => {};
  }

  const safeLimit = Math.max(1, Math.min(50, Math.floor(maxResults)));
  const q = query(
    collection(db, 'leaderboard'),
    where('careerWins', '>=', 0),
    orderBy('careerWins', 'desc'),
    limit(safeLimit)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const rows: LeaderboardEntry[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          uid: typeof data.uid === 'string' ? data.uid : d.id,
          displayName: sanitizeDisplayName(data.displayName, null),
          favoriteFranchiseId: sanitizeFranchiseId(data.favoriteFranchiseId),
          careerWins:
            typeof data.careerWins === 'number' ? Math.max(0, Math.floor(data.careerWins)) : 0,
          careerMatches:
            typeof data.careerMatches === 'number'
              ? Math.max(0, Math.floor(data.careerMatches))
              : 0,
          careerPurse: typeof data.careerPurse === 'number' ? Math.max(0, data.careerPurse) : 120.0,
        };
      });
      rows.sort(
        (a, b) =>
          b.careerWins - a.careerWins ||
          b.careerPurse - a.careerPurse ||
          a.careerMatches - b.careerMatches
      );
      onUpdate(rows);
    },
    (error) => {
      if (onError) onError(error);
      try {
        handleFirestoreError(error, OperationType.LIST, 'leaderboard');
      } catch {
        // surfaced via console / optional onError
      }
    }
  );
}

export async function fetchUserGlobalRankStats(
  careerWins: number
): Promise<{ rank: number; totalPlayers: number }> {
  if (!auth.currentUser) {
    return { rank: 1, totalPlayers: 1 };
  }
  const safeWins = Math.max(0, Math.min(100000, Math.floor(careerWins)));
  try {
    const higherQuery = query(
      collection(db, 'leaderboard'),
      where('careerWins', '>', safeWins)
    );
    const totalQuery = query(
      collection(db, 'leaderboard'),
      where('careerWins', '>=', 0)
    );
    const [higherSnap, totalSnap] = await Promise.all([
      getCountFromServer(higherQuery),
      getCountFromServer(totalQuery),
    ]);
    const higherCount = higherSnap.data().count;
    const totalPlayers = Math.max(1, totalSnap.data().count);
    return {
      rank: higherCount + 1,
      totalPlayers,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'leaderboard');
  }
}

export async function registerWithEmail(params: {
  name: string;
  email: string;
  password: string;
}): Promise<User> {
  const cred = await createUserWithEmailAndPassword(auth, params.email.trim(), params.password);
  const cleanName = params.name.trim().slice(0, 60);
  if (cleanName) {
    await updateProfile(cred.user, { displayName: cleanName });
  }
  try {
    await sendEmailVerification(cred.user);
  } catch {
    // non-fatal if email verification rate-limited
  }
  return cred.user;
}

export async function loginWithEmail(params: { email: string; password: string }): Promise<User> {
  const cred = await signInWithEmailAndPassword(auth, params.email.trim(), params.password);
  return cred.user;
}

export async function loginWithGoogle(): Promise<User> {
  const cred = await signInWithPopup(auth, googleProvider);
  return cred.user;
}

export async function resetPasswordByEmail(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

export async function resendVerificationEmail(user: User): Promise<void> {
  await sendEmailVerification(user);
}

export async function logoutAccount(): Promise<void> {
  await signOut(auth);
}

export { onAuthStateChanged, type User };
