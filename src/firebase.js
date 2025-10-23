// firebase.js
import { initializeApp } from "firebase/app";
import {
  getAuth,
  browserLocalPersistence,
  setPersistence,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAnalytics, isSupported as analyticsIsSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyDliMSLr6DVGxGA3ZSPi1D3fLbSCpRUkeE",
  authDomain: "nvproxys-b3b5f.firebaseapp.com",
  projectId: "nvproxys-b3b5f",
  storageBucket: "nvproxys-b3b5f.firebasestorage.app",
  messagingSenderId: "420040389701",
  appId: "1:420040389701:web:aae1d8bf498be1c8b45f2c",
  measurementId: "G-H9HP5LBYW2",
};

export const app = initializeApp(firebaseConfig);

// Auth + persistencia en localStorage
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {
  // Ignora si el entorno no permite localStorage (por ejemplo, modo privado estricto)
});

export const db = getFirestore(app);

// Analytics solo en navegador y si está soportado
export let analytics = null;
if (typeof window !== "undefined") {
  analyticsIsSupported().then((ok) => {
    if (ok) analytics = getAnalytics(app);
  }).catch(() => {});
}
