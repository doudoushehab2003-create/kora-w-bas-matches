import { buildDailyQuiz } from './quiz.js';
import { POINTS_EXACT, scorePrediction, shouldFetch } from './settle.js';
import { DAY, HOUR, startOfUtcDay, utcDate } from './util.js';

const CHUNK = 400;
const PREDICTION_EXPIRY = 14 * DAY;

async function commit(db, ops) {
  for (let i = 0; i < ops.length; i += CHUNK) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + CHUNK)) {
      if (op.type === 'set') batch.set(op.ref, op.data, op.opts ?? {});
      else batch.update(op.ref, op.data);
    }
    await batch.commit();
  }
}

export async function runJob({ db, increment, fetchMatches, token, now = Date.now(), log = console.log }) {
  const today = utcDate(now);
  const dateFrom = utcDate(now - DAY);
  const dateTo = utcDate(now + 2 * DAY);
  const from = startOfUtcDay(dateFrom);
  const to = startOfUtcDay(dateTo);

  const loadMatches = async () =>
    (await db.collection('matches').where('kickoff', '>=', from).where('kickoff', '<', to).get()).docs.map((d) => ({
      ...d.data(),
      id: d.id,
    }));

  const stateRef = db.doc('meta/state');
  const state = (await stateRef.get()).data() ?? {};
  let matches = await loadMatches();

  if (shouldFetch({ now, today, state, matches })) {
    const fresh = await fetchMatches({ token, dateFrom, dateTo });
    await commit(
      db,
      fresh.map((m) => ({ type: 'set', ref: db.doc(`matches/${m.id}`), data: { ...m, updatedAt: now }, opts: { merge: true } })),
    );
    await stateRef.set({ lastFullRefresh: today }, { merge: true });
    matches = await loadMatches();
    log(`Saved ${fresh.length} matches`);
  } else {
    log('No fetch needed this time');
  }

  await settlePredictions({ db, increment, matches, now, log });
  await publishDailyQuiz({ db, matches, now, today, log });
}

async function settlePredictions({ db, increment, matches, now, log }) {
  const known = new Map(matches.map((m) => [m.id, m]));
  const pending = (await db.collection('predictions').where('settled', '==', false).limit(500).get()).docs;

  for (const id of new Set(pending.map((d) => d.data().matchId))) {
    if (known.has(id)) continue;
    const snap = await db.doc(`matches/${id}`).get();
    if (snap.exists) known.set(id, { ...snap.data(), id });
  }

  const ops = [];
  const players = new Map();
  for (const d of pending) {
    const p = d.data();
    const points = scorePrediction(p, known.get(p.matchId));
    if (points === null) {
      if (now - p.createdAt > PREDICTION_EXPIRY) ops.push({ type: 'update', ref: d.ref, data: { settled: true, points: 0 } });
      continue;
    }
    ops.push({ type: 'update', ref: d.ref, data: { settled: true, points } });
    const a = players.get(p.playerId) ?? { name: p.name, points: 0, exact: 0, correct: 0, played: 0 };
    a.points += points;
    a.played += 1;
    if (points === POINTS_EXACT) a.exact += 1;
    if (points > 0) a.correct += 1;
    players.set(p.playerId, a);
  }
  for (const [playerId, a] of players) {
    ops.push({
      type: 'set',
      ref: db.doc(`predictionScores/${playerId}`),
      data: {
        name: a.name,
        points: increment(a.points),
        exact: increment(a.exact),
        correct: increment(a.correct),
        played: increment(a.played),
        updatedAt: now,
      },
      opts: { merge: true },
    });
  }
  await commit(db, ops);
  if (players.size) log(`Scored predictions for ${players.size} players`);
}

async function publishDailyQuiz({ db, matches, now, today, log }) {
  const ref = db.doc(`dailyQuiz/${today}`);
  if ((await ref.get()).exists) return;
  const recent = matches.filter((m) => m.status === 'finished' && m.kickoff >= now - 36 * HOUR);
  const questions = buildDailyQuiz(recent, today);
  if (!questions.length) return;
  await ref.set({ date: today, createdAt: now, questions });
  log(`Published daily quiz with ${questions.length} questions`);
}
