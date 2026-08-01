import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from "firebase/auth";

// Firebase configuration for project: dividendpro-3b397
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCDLLYek5WgHBdJYe28CSx2IdHdch4lksQ",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "dividendpro-3b397.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "dividendpro-3b397",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "dividendpro-3b397.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "539817560279",
};

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export { app, db, auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged, type User };
