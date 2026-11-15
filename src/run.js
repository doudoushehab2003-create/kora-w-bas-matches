import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { runJob } from './job.js';
import { fetchMatches } from './providers/footballData.js';

const token = process.env.FOOTBALL_DATA_TOKEN;
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!token || !serviceAccount) {
  console.error('Set FOOTBALL_DATA_TOKEN and FIREBASE_SERVICE_ACCOUNT (see README.md).');
  process.exit(1);
}

initializeApp({ credential: cert(JSON.parse(serviceAccount)) });

await runJob({
  db: getFirestore(),
  increment: (n) => FieldValue.increment(n),
  fetchMatches,
  token,
});
