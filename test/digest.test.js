import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDigest, runDigest } from '../src/signupDigest.js';

const DAY = 24 * 60 * 60 * 1000;
const now = 10 * DAY;

test('only players from the last 24 hours are listed, without passwords', () => {
  const d = buildDigest(
    [
      { name: 'old', email: 'o@x.com', createdAt: now - 2 * DAY },
      { name: 'new', email: 'n@x.com', createdAt: now - 1000, password: 'secret' },
    ],
    now - DAY,
    now,
  );
  assert.match(d.text, /new <n@x.com>/);
  assert.doesNotMatch(d.text, /old|secret/);
  assert.match(d.subject, /1 new player/);
});

test('no email when nobody signed up', () => {
  assert.equal(buildDigest([], now - DAY, now), null);
});

test('runDigest sends one mail', async () => {
  const docs = [{ data: () => ({ name: 'a', email: 'a@x.com', createdAt: now - 5 }) }];
  const db = { collection: () => ({ where: () => ({ where: () => ({ get: async () => ({ docs, size: 1 }) }) }) }) };
  const sent = [];
  const r = await runDigest({ db, now, sendMail: async (m) => sent.push(m) });
  assert.equal(r.sent, true);
  assert.equal(sent.length, 1);
});
