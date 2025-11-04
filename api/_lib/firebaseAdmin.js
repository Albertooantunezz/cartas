// /api/_lib/firebaseAdmin.js
import admin from "firebase-admin";

function getEnvCreds() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) return null;

  // Soporta "\n" o saltos reales
  if (privateKey.includes("\\n")) privateKey = privateKey.replace(/\\n/g, "\n");

  // Pequeña validación para evitar el fallo típico (JSON entero pegado)
  if (!privateKey.includes("BEGIN PRIVATE KEY")) {
    throw new Error(
      "FIREBASE_PRIVATE_KEY no parece ser un PEM. Copia SOLO el campo `private_key` del JSON, no el JSON completo."
    );
  }

  return { projectId, clientEmail, privateKey };
}

if (!admin.apps.length) {
  const creds = getEnvCreds();
  if (!creds) throw new Error("Faltan variables de entorno de Firebase Admin");

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: creds.projectId,
      clientEmail: creds.clientEmail,
      privateKey: creds.privateKey,
    }),
  });
}

export const db = admin.firestore();
export const auth = admin.auth();
