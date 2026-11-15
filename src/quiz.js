import { arabicName } from './arabicNames.js';
import { seededRandom, shuffled } from './util.js';

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
// Forces left-to-right order so "2–1" is not flipped inside Arabic text.
const LRM = '‎';

const dayLabel = (ms) => {
  const d = new Date(ms);
  return { en: `${d.getUTCDate()} ${MONTHS_EN[d.getUTCMonth()]}`, ar: `${d.getUTCDate()} ${MONTHS_AR[d.getUTCMonth()]}` };
};

const vsEn = (m) => `${m.home} vs ${m.away}`;
const vsAr = (m) => `${arabicName(m.home)} ضد ${arabicName(m.away)}`;
const scoreText = (h, a) => `${h}–${a}`;
const total = (m) => m.homeScore + m.awayScore;

/**
 * Builds quiz questions about finished matches. The correct answer is always listed first
 * (the app shuffles the options). Returns an empty list when there is too little data.
 */
export function buildDailyQuiz(finished, dateStr) {
  const rng = seededRandom(dateStr);
  const matches = finished.filter(
    (m) => m.status === 'finished' && Number.isInteger(m.homeScore) && Number.isInteger(m.awayScore) && m.home && m.away,
  );
  if (matches.length < 3) return [];

  const questions = [];
  const usedMatches = new Set();
  const add = (difficulty, en, ar) => {
    const n = questions.length + 1;
    questions.push({ id: `dq${dateStr.replace(/-/g, '')}${n}`, difficulty, en, ar });
  };
  const pick = (list) => {
    const fresh = list.filter((m) => !usedMatches.has(m.id));
    const pool = fresh.length ? fresh : list;
    return pool.length ? shuffled(pool, rng)[0] : null;
  };
  const distinct = (correct, candidates, count = 3) => {
    const out = [];
    for (const c of candidates) if (c !== correct && !out.includes(c)) out.push(c);
    return out.length >= count ? out.slice(0, count) : null;
  };

  const decisive = matches.filter((m) => m.homeScore !== m.awayScore);
  const winnerOf = (m) => (m.homeScore > m.awayScore ? m.home : m.away);
  const loserOf = (m) => (m.homeScore > m.awayScore ? m.away : m.home);
  const winners = new Set(decisive.map(winnerOf));
  const nonWinners = [...new Set(matches.flatMap((m) => [m.home, m.away]).filter((t) => !winners.has(t)))];

  // Easy: which team won (wrong answers are teams that did not win their match).
  for (let i = 0; i < 2; i++) {
    const m = pick(decisive);
    if (!m) break;
    const wrong = distinct(winnerOf(m), [loserOf(m), ...shuffled(nonWinners, rng)]);
    if (!wrong) break;
    usedMatches.add(m.id);
    const d = dayLabel(m.kickoff);
    add(
      'easy',
      { q: `Which team won its match on ${d.en}?`, options: [winnerOf(m), ...wrong] },
      { q: `أي فريق فاز في مباراته يوم ${d.ar}؟`, options: [arabicName(winnerOf(m)), ...wrong.map(arabicName)] },
    );
  }

  // Easy: total goals.
  {
    const m = pick(matches);
    const t = m && total(m);
    const wrong = m && distinct(t, shuffled([t + 1, t + 2, t + 3, t + 4, t - 1, t - 2].filter((n) => n >= 0), rng));
    if (m && wrong) {
      usedMatches.add(m.id);
      const opts = [t, ...wrong].map(String);
      add(
        'easy',
        { q: `How many goals were scored in ${vsEn(m)}?`, options: opts },
        { q: `كم عدد الأهداف في مباراة ${vsAr(m)}؟`, options: opts },
      );
    }
  }

  // Medium: final score.
  {
    const m = pick(matches);
    if (m) {
      const h = m.homeScore;
      const a = m.awayScore;
      const candidates = shuffled(
        [
          [a, h],
          [h + 1, a],
          [h, a + 1],
          [Math.max(0, h - 1), a],
          [h, Math.max(0, a - 1)],
          [h + 1, a + 1],
        ].map(([x, y]) => scoreText(x, y)),
        rng,
      );
      const wrong = distinct(scoreText(h, a), candidates);
      if (wrong) {
        usedMatches.add(m.id);
        const opts = [scoreText(h, a), ...wrong];
        add(
          'medium',
          { q: `What was the final score of ${vsEn(m)}?`, options: opts },
          { q: `ما النتيجة النهائية لمباراة ${vsAr(m)}؟`, options: opts.map((o) => `${LRM}${o}${LRM}`) },
        );
      }
    }
  }

  // Medium: which match ended in a draw.
  {
    const draws = matches.filter((m) => m.homeScore === m.awayScore);
    const others = matches.filter((m) => m.homeScore !== m.awayScore);
    const m = pick(draws);
    if (m && others.length >= 3) {
      const wrong = shuffled(others, rng).slice(0, 3);
      usedMatches.add(m.id);
      add(
        'medium',
        { q: 'Which of these matches ended in a draw?', options: [vsEn(m), ...wrong.map(vsEn)] },
        { q: 'أي من هذه المباريات انتهت بالتعادل؟', options: [vsAr(m), ...wrong.map(vsAr)] },
      );
    }
  }

  // Hard: which match had the most goals (only when there is a single highest scoring match).
  {
    const top = Math.max(...matches.map(total));
    const leaders = matches.filter((m) => total(m) === top);
    const rest = matches.filter((m) => total(m) < top);
    if (leaders.length === 1 && rest.length >= 3) {
      const wrong = shuffled(rest, rng).slice(0, 3);
      add(
        'hard',
        { q: 'Which of these matches had the most goals?', options: [vsEn(leaders[0]), ...wrong.map(vsEn)] },
        { q: 'أي من هذه المباريات شهدت أكثر عدد من الأهداف؟', options: [vsAr(leaders[0]), ...wrong.map(vsAr)] },
      );
    }
  }

  return questions.length >= 3 ? questions : [];
}
