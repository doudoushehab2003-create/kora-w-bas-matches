import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runPush } from '../src/push.js';

/** Tiny in-memory stand-in for the Firestore calls runPush makes. */
function fakeDb(data) {
  const col = (name) => Object.entries(data[name] ?? {}).map(([id, v]) => ({ id, data: () => v }));
  const where = (name, f, op, val) => ({ get: async () => ({ docs: col(name).filter((d) => (op === '>' ? d.data()[f] > val : d.data()[f] === val)) }) });
  return {
    data,
    doc: (path) => {
      const [c, id] = path.split('/');
      return {
        get: async () => ({ data: () => data[c]?.[id] }),
        set: async (v) => (data[c] = { ...data[c], [id]: { ...data[c]?.[id], ...v } }),
        delete: async () => delete data[c][id],
      };
    },
    collection: (name) => ({ get: async () => ({ docs: col(name) }), where: (f, op, v) => where(name, f, op, v) }),
  };
}
// Thursday 2026-11-19 is a multiple of 7 days since 1970-01-01 (a Thursday).
const THU_20H = Date.UTC(2026, 10, 19, 18, 0); // 20:00 Cairo

test('Thursday, confirmed results and streak reminders go to the right devices, once', async () => {
  const day = Math.floor((THU_20H + 7_200_000) / 86_400_000);
  assert.equal(day % 7, 0);
  const db = fakeDb({
    pushSubs: { d1: { uid: 'u1', lang: 'ar', sub: '{"endpoint":"a"}' }, d2: { uid: '', lang: 'en', sub: '{"endpoint":"b"}' }, d3: { uid: 'u2', sub: '{"endpoint":"gone"}' } },
    submissions: { s1: { uid: 'u1', status: 'reviewed', points: 7, reviewedAt: THU_20H - 1000 }, s2: { uid: 'u1', status: 'rejected', reviewedAt: THU_20H - 900 } },
    streaks: { u1: { day: day - 1, count: 4, best: 4 }, u2: { day: day - 1, count: 1, best: 3 } },
    config: {},
  });
  const sent = [];
  const send = async (sub, payload) => {
    if (sub.endpoint === 'gone') throw Object.assign(new Error('gone'), { statusCode: 410 });
    sent.push([sub.endpoint, JSON.parse(payload)]);
  };
  const r = await runPush({ db, send, now: THU_20H, news: async () => [] });
  assert.deepEqual(r, { weekly: 2, confirmed: 1, streak: 1, news: 0, signups: 0, removed: 1 });
  assert.match(sent.find(([e, p]) => e === 'a' && p.title.includes('اتأكدت'))[1].body, /7/);
  assert.equal(db.data.pushSubs.d3, undefined);
  // Second run the same evening sends nothing new.
  sent.length = 0;
  const again = await runPush({ db, send, now: THU_20H + 900_000, news: async () => [] });
  assert.deepEqual(again, { weekly: 0, confirmed: 0, streak: 0, news: 0, signups: 0, removed: 0 });
});

test('breaking news respects opt-out and the daily cap; new sign-ups reach the Manager', async () => {
  const now = Date.UTC(2026, 10, 18, 12, 0); // 14:00 Cairo, a Wednesday
  const db = fakeDb({
    pushSubs: { d1: { uid: 'u1', lang: 'ar', sub: '{"endpoint":"a"}' }, d2: { uid: '', lang: 'en', news: false, sub: '{"endpoint":"b"}' } },
    ownerPush: { m1: { sub: '{"endpoint":"owner"}' } },
    users: { n1: { name: 'Zizo', createdAt: now - 60_000 }, old: { name: 'Old', createdAt: now - 86_400_000 } },
    config: { pushState: { usersAt: now - 600_000 } },
  });
  const sent = [];
  const send = async (sub, payload) => sent.push([sub.endpoint, JSON.parse(payload)]);
  const story = { id: '1', headline: 'Big transfer', url: 'https://x/1', published: now - 5 * 60_000 };
  const r = await runPush({ db, send, now, news: async () => [story] });
  assert.equal(r.news, 1);
  assert.equal(r.signups, 1);
  assert.deepEqual(sent.map(([e]) => e).sort(), ['a', 'owner']);
  assert.equal(sent.find(([e]) => e === 'owner')[1].body, 'Zizo');
  assert.equal(sent.find(([e]) => e === 'owner')[1].url.endsWith('/manager/'), true);
  // Same story and no new players: nothing more.
  sent.length = 0;
  const again = await runPush({ db, send, now: now + 900_000, news: async () => [story] });
  assert.equal(again.news + again.signups, 0);
  // Daily cap.
  db.data.config.pushState.newsCount = 4;
  const capped = await runPush({ db, send, now: now + 1_800_000, news: async () => [{ ...story, id: '2', published: now + 1_700_000 }] });
  assert.equal(capped.news, 0);
});
