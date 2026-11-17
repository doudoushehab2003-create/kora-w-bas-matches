import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import webpush from 'web-push';
import { APP_URL, VAPID_PUBLIC, runPush } from './push.js';

const { FIREBASE_SERVICE_ACCOUNT, VAPID_PRIVATE_KEY } = process.env;
if (!FIREBASE_SERVICE_ACCOUNT || !VAPID_PRIVATE_KEY) {
  // Not set up yet: skip quietly so the 15-minute schedule doesn't fail (and email) every run.
  console.log('Push skipped: set the FIREBASE_SERVICE_ACCOUNT and VAPID_PRIVATE_KEY secrets (see README.md).');
  process.exit(0);
}
initializeApp({ credential: cert(JSON.parse(FIREBASE_SERVICE_ACCOUNT)) });
webpush.setVapidDetails(APP_URL, VAPID_PUBLIC, VAPID_PRIVATE_KEY);

const result = await runPush({ db: getFirestore(), send: (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 6 * 3600 }) });
console.log('Push:', JSON.stringify(result));
