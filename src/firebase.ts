import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from "firebase/auth";

// Firebase configuration for project: dividendpro-3b397
const firebaseConfig = {
  apiKey: (import.meta as any).env?.VITE_FIREBASE_API_KEY || "AIzaSyD-mockKeyForLocalDevEnvOnly",
  authDomain: "dividendpro-3b397.firebaseapp.com",
  projectId: "dividendpro-3b397",
  storageBucket: "dividendpro-3b397.appspot.com",
  messagingSenderId: "383971234567",
  appId: "1:383971234567:web:abcd1234efgh5678"
};

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export { app, db, auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged, type User };
