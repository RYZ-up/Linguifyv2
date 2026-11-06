import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getDatabase } from 'firebase-admin/database';
import { HttpError } from './game-core.mjs';

export function services() {
  const existing = getApps().find(app => app.name === 'linguify-game');
  let app = existing;
  if (!app) {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON || !process.env.FIREBASE_DATABASE_URL) throw new HttpError(503, 'Service non configuré.');
    const account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (process.env.FIREBASE_PROJECT_ID && account.project_id !== process.env.FIREBASE_PROJECT_ID) throw new HttpError(503, 'Projet Firebase invalide.');
    app = initializeApp({ credential: cert(account), projectId: account.project_id, databaseURL: process.env.FIREBASE_DATABASE_URL }, 'linguify-game');
  }
  return { auth: getAuth(app), firestore: getFirestore(app), database: getDatabase(app) };
}
