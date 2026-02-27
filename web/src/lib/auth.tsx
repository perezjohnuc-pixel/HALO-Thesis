import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
} from "firebase/auth";
import { Timestamp, doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import type { UserDoc } from "./types";

type AuthCtx = {
  user: User | null;
  userDoc: UserDoc | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubUserDoc: null | (() => void) = null;
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (unsubUserDoc) {
        unsubUserDoc();
        unsubUserDoc = null;
      }

      setUser(u);
      setUserDoc(null);
      setLoading(true);

      if (!u) {
        setLoading(false);
        return;
      }

      // Ensure user profile doc exists.
      const ref = doc(db, "users", u.uid);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        // Use a concrete timestamp (instead of a serverTimestamp transform)
        // to avoid rule/type edge-cases during thesis demos.
        await setDoc(
          ref,
          {
            uid: u.uid,
            email: u.email ?? null,
            role: "user",
            createdAt: Timestamp.now(),
            lastLoginAt: Timestamp.now(),
          } satisfies UserDoc as any,
          { merge: true }
        );
      } else {
        // Update last login timestamp
        await setDoc(ref, { lastLoginAt: Timestamp.now() } as any, { merge: true });
      }

      // Subscribe to user doc for role changes (admin promotion).
      unsubUserDoc = onSnapshot(ref, (s) => {
        setUserDoc(s.exists() ? (s.data() as UserDoc) : null);
        setLoading(false);
      });
    });

    return () => {
      if (unsubUserDoc) unsubUserDoc();
      unsub();
    };
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      userDoc,
      loading,
      async signIn(email, password) {
        await signInWithEmailAndPassword(auth, email, password);
      },
      async register(email, password) {
        await createUserWithEmailAndPassword(auth, email, password);
      },
      async signOut() {
        await fbSignOut(auth);
      },
    }),
    [user, userDoc, loading]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within <AuthProvider>");
  return v;
}
