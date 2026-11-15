import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runJob } from '../src/job.js';
import { DAY, HOUR } from '../src/util.js';

// A tiny in-memory stand-in for the parts of the Firestore Admin API the job uses.
function fakeDb(initial = {}) {
  const store = new Map(Object.entries(initial));
  const refOf = (path) => ({ path, id: path.split('/').pop() });
  const snapOf = (path) => ({ exists: store.has(path), data: () => store.get(path), ref: refOf(path), id: path.split('/').pop() });
  const apply = (path, data, merge) => {
    const next = { ...(merge ? store.get(path) : {}) };
    for (const [k, v] of Object.entries(data)) next[k] = v && v.__inc !== undefined ? (next[k] ?? 0) + v.__inc : v;
    store.set(path, next);
  };
  const db = {
    store,
    doc: (path) => ({ ...refOf(path), get: async () => snapOf(path), set: async (d, o) => apply(path, d, o?.merge) }),
    collection: (name) => {
      const filters = [];
      let max = Infinity;
      const q = {
        where: (f, op, v) => (filters.push([f, op, v]), q),
        limit: (n) => ((max = n), q),
        get: async () => ({
          docs: [...store.keys()]
            .filter((p) => p.startsWith(`${name}/`))
            .filter((p) => filters.every(([f, op, v]) => ({ '>=': store.get(p)[f] >= v, '<': store.get(p)[f] < v, '==': store.get(p)[f] === v })[op]))
            .slice(0, max)
            .map(snapOf),
        }),
      };
      return q;
    },
    batch: () => {
      const ops = [];
      return {
        set: (ref, d, o) => ops.push(() => apply(ref.path, d, o?.merge)),
        update: (ref, d) => ops.push(() => apply(ref.path, d, true)),
        commit: async () => ops.forEach((f) => f()),
      };
    },
  };
  return db;
}

const NOW = Date.parse('2026-11-15T10:00:00Z');
const increment = (n) => ({ __inc: n });
const m = (id, home, away, hs, as, status, kickoff) => ({ id, home, away, homeScore: hs, awayScore: as, status, kickoff, competition: 'X' });

test('job saves matches, scores predictions once, publishes the quiz', async () => {
  const yesterday = NOW - DAY + 5 * HOUR;
  const finished = [
    m('fd1', 'Arsenal', 'Chelsea', 2, 1, 'finished', yesterday),
    m('fd2', 'Liverpool', 'Everton', 3, 2, 'finished', yesterday),
    m('fd3', 'Real Madrid', 'Sevilla', 1, 0, 'finished', yesterday),
    m('fd4', 'Napoli', 'Roma', 0, 0, 'finished', yesterday),
    m('fd5', 'Bayern', 'Dortmund', 4, 2, 'finished', yesterday),
  ];
  const db = fakeDb({
    'predictions/fd1_p1': { matchId: 'fd1', playerId: 'p1', name: 'Sara', home: 2, away: 1, createdAt: NOW - DAY, settled: false, points: 0 },
    'predictions/fd2_p1': { matchId: 'fd2', playerId: 'p1', name: 'Sara', home: 0, away: 1, createdAt: NOW - DAY, settled: false, points: 0 },
    'predictions/fd3_p2': { matchId: 'fd3', playerId: 'p2', name: 'Omar', home: 3, away: 0, createdAt: NOW - DAY, settled: false, points: 0 },
    'predictions/fd9_p2': { matchId: 'fd9', playerId: 'p2', name: 'Omar', home: 1, away: 1, createdAt: NOW - DAY, settled: false, points: 0 },
  });
  const logs = [];
  const fetchMatches = async () => finished;
  await runJob({ db, increment, fetchMatches, token: 't', now: NOW, log: (x) => logs.push(x) });

  assert.equal(db.store.get('matches/fd1').updatedAt, NOW);
  assert.equal(db.store.get('meta/state').lastFullRefresh, '2026-11-15');
  assert.equal(db.store.get('predictions/fd1_p1').points, 5);
  assert.equal(db.store.get('predictions/fd2_p1').points, 0);
  assert.equal(db.store.get('predictions/fd3_p2').points, 2);
  assert.equal(db.store.get('predictions/fd9_p2').settled, false, 'unknown match stays unsettled');
  assert.deepEqual(
    { points: db.store.get('predictionScores/p1').points, exact: db.store.get('predictionScores/p1').exact, played: db.store.get('predictionScores/p1').played },
    { points: 5, exact: 1, played: 2 },
  );
  assert.equal(db.store.get('predictionScores/p2').points, 2);
  const quiz = db.store.get('dailyQuiz/2026-11-15');
  assert.ok(quiz && quiz.questions.length >= 4);

  // A second run the same morning must not fetch, double-score or republish.
  let fetched = 0;
  await runJob({ db, increment, fetchMatches: async () => (fetched++, []), token: 't', now: NOW + 15 * 60e3, log: () => {} });
  assert.equal(fetched, 0);
  assert.equal(db.store.get('predictionScores/p1').points, 5);
  assert.equal(db.store.get('dailyQuiz/2026-11-15').createdAt, NOW);
});

test('old unscorable predictions expire', async () => {
  const db = fakeDb({
    'predictions/fd7_p3': { matchId: 'fd7', playerId: 'p3', name: 'Lee', home: 1, away: 0, createdAt: NOW - 20 * DAY, settled: false, points: 0 },
  });
  await runJob({ db, increment, fetchMatches: async () => [], token: 't', now: NOW, log: () => {} });
  assert.equal(db.store.get('predictions/fd7_p3').settled, true);
  assert.equal(db.store.get('predictionScores/p3'), undefined);
});
