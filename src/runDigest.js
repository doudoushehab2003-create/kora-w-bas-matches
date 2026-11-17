import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import nodemailer from 'nodemailer';
import { runDigest } from './signupDigest.js';

const { FIREBASE_SERVICE_ACCOUNT, SMTP_USER, SMTP_PASS, DIGEST_TO } = process.env;
if (!FIREBASE_SERVICE_ACCOUNT || !SMTP_USER || !SMTP_PASS || !DIGEST_TO) {
  console.error('Set FIREBASE_SERVICE_ACCOUNT, SMTP_USER, SMTP_PASS and DIGEST_TO (see README.md).');
  process.exit(1);
}

initializeApp({ credential: cert(JSON.parse(FIREBASE_SERVICE_ACCOUNT)) });
const mail = nodemailer.createTransport({ service: 'gmail', auth: { user: SMTP_USER, pass: SMTP_PASS } });

const result = await runDigest({
  db: getFirestore(),
  sendMail: ({ subject, text }) => mail.sendMail({ from: SMTP_USER, to: DIGEST_TO, subject, text }),
});
console.log(result.sent ? `Sent digest for ${result.count} new players.` : 'No new players today.');
