import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";

// Read Firebase config from Vite environment variables.
// Create web/.env from web/.env.example.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

if (!firebaseConfig.projectId) {
  // Fail fast with a helpful message.
  throw new Error(
    "Missing Firebase config. Create web/.env (copy from web/.env.example) and set VITE_FIREBASE_PROJECT_ID etc."
  );
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Optional: connect to Firebase Emulator Suite
// - For browser dev on your laptop: set VITE_USE_EMULATORS=true and leave host=localhost
// - For testing on a phone on the same Wi‑Fi: set host to your laptop LAN IP (e.g. 192.168.1.10)
const useEmu = String(import.meta.env.VITE_USE_EMULATORS || "").toLowerCase() === "true";
const emuHost = import.meta.env.VITE_EMULATOR_HOST || "localhost";

if (useEmu) {
  const firestorePort = Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT || 8080);
  const authPort = Number(import.meta.env.VITE_AUTH_EMULATOR_PORT || 9099);
  // IMPORTANT: connect*Emulator should run only once per page load (HMR-safe).
  const g = globalThis as any;
  if (!g.__HALO_EMULATORS_CONNECTED) {
    connectFirestoreEmulator(db, emuHost, firestorePort);
    connectAuthEmulator(auth, `http://${emuHost}:${authPort}`);
    g.__HALO_EMULATORS_CONNECTED = true;
  }
}
