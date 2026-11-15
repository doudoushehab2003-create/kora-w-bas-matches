import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arabicName } from '../src/arabicNames.js';
import { normalizeMatch } from '../src/providers/footballData.js';
import { buildDailyQuiz } from '../src/quiz.js';
import { scorePrediction, shouldFetch } from '../src/settle.js';
import { HOUR, MINUTE } from '../src/util.js';

const T0 = Date.parse('2026-11-14T15:00:00Z');
const fin = (id, home, away, hs, as) => ({ id, home, away, homeScore: hs, awayScore: as, status: 'finished', kickoff: T0 });

const SAMPLE = [
  fin('a', 'Arsenal', 'Chelsea', 2, 1),
  fin('b', 'Liverpool', 'Everton', 3, 2),
  fin('c', 'Real Madrid', 'Sevilla', 1, 0),
  fin('d', 'Napoli', 'Roma', 0, 0),
  fin('e', 'Bayern', 'Dortmund', 4, 2),
  fin('f', 'Lyon', 'Marseille', 1, 2),
];

test('football-data match is normalised', () => {
  const m = normalizeMatch({
    id: 123,
    utcDate: '2026-11-14T15:00:00Z',
    status: 'IN_PLAY',
    competition: { name: 'Premier League', code: 'PL' },
    homeTeam: { name: 'Arsenal FC', shortName: 'Arsenal', crest: 'x.png' },
    awayTeam: { name: 'Chelsea FC', shortName: 'Chelsea' },
    score: { fullTime: { home: 1, away: 0 } },
  });
  assert.equal(m.id, 'fd123');
  assert.equal(m.status, 'live');
  assert.equal(m.home, 'Arsenal');
  assert.equal(m.homeScore, 1);
  assert.equal(m.kickoff, T0);
});

test('match without teams is skipped', () => {
  assert.equal(normalizeMatch({ id: 1, utcDate: '2026-11-14T15:00:00Z', status: 'TIMED', homeTeam: {}, awayTeam: {} }), null);
});

test('prediction scoring', () => {
  const m = { status: 'finished', homeScore: 2, awayScore: 1 };
  assert.equal(scorePrediction({ home: 2, away: 1 }, m), 5);
  assert.equal(scorePrediction({ home: 3, away: 0 }, m), 2);
  assert.equal(scorePrediction({ home: 1, away: 1 }, m), 0);
  assert.equal(scorePrediction({ home: 0, away: 1 }, m), 0);
  assert.equal(scorePrediction({ home: 2, away: 1 }, { ...m, status: 'live' }), null);
  assert.equal(scorePrediction({ home: 1, away: 1 }, { status: 'finished', homeScore: 0, awayScore: 0 }), 2);
});

test('fetch decision', () => {
  const now = T0;
  const base = { now, today: '2026-11-14', state: { lastFullRefresh: '2026-11-14' } };
  assert.equal(shouldFetch({ ...base, state: {}, matches: [] }), true);
  assert.equal(shouldFetch({ ...base, matches: [] }), false);
  assert.equal(shouldFetch({ ...base, matches: [{ status: 'live', kickoff: now - HOUR }] }), true);
  assert.equal(shouldFetch({ ...base, matches: [{ status: 'upcoming', kickoff: now + 10 * MINUTE }] }), true);
  assert.equal(shouldFetch({ ...base, matches: [{ status: 'upcoming', kickoff: now + 3 * HOUR }] }), false);
  assert.equal(shouldFetch({ ...base, matches: [{ status: 'finished', kickoff: now - 3 * HOUR }] }), false);
});

test('Arabic team names', () => {
  assert.equal(arabicName('Real Madrid CF'), 'ريال مدريد');
  assert.equal(arabicName('FC Bayern München'), 'بايرن ميونخ');
  assert.equal(arabicName('Unknown Town'), 'Unknown Town');
});

test('daily quiz is well formed and correct', () => {
  const qs = buildDailyQuiz(SAMPLE, '2026-11-15');
  assert.ok(qs.length >= 4, `expected at least 4 questions, got ${qs.length}`);
  assert.deepEqual(qs, buildDailyQuiz(SAMPLE, '2026-11-15'), 'same day gives the same quiz');
  const ids = new Set();
  for (const q of qs) {
    assert.ok(!ids.has(q.id));
    ids.add(q.id);
    for (const lang of ['en', 'ar']) {
      assert.equal(q[lang].options.length, 4, q[lang].q);
      assert.equal(new Set(q[lang].options).size, 4, q[lang].q);
    }
  }
  const winners = new Set(['Arsenal', 'Liverpool', 'Real Madrid', 'Bayern', 'Marseille']);
  for (const q of qs.filter((x) => x.en.q.startsWith('Which team won'))) {
    const [right, ...wrong] = q.en.options;
    assert.ok(winners.has(right), `${right} should be a winner`);
    for (const w of wrong) assert.ok(!winners.has(w), `${w} must not be a winner`);
  }
  const draw = qs.find((x) => x.en.q.includes('draw'));
  assert.equal(draw.en.options[0], 'Napoli vs Roma');
  const score = qs.find((x) => x.en.q.startsWith('What was the final score'));
  const [home, away] = score.en.q.replace('What was the final score of ', '').replace('?', '').split(' vs ');
  const real = SAMPLE.find((m) => m.home === home && m.away === away);
  assert.equal(score.en.options[0], `${real.homeScore}–${real.awayScore}`);
  const most = qs.find((x) => x.en.q.includes('most goals'));
  assert.equal(most.en.options[0], 'Bayern vs Dortmund');
});

test('too little data gives no quiz', () => {
  assert.deepEqual(buildDailyQuiz(SAMPLE.slice(0, 2), '2026-11-15'), []);
});
