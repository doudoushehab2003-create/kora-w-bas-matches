import { HOUR, MINUTE } from './util.js';

export const POINTS_EXACT = 5;
export const POINTS_OUTCOME = 2;

const outcome = (h, a) => (h > a ? 'H' : h < a ? 'A' : 'D');

/** Points for one prediction, or null while the match is not finished. */
export function scorePrediction(pred, match) {
  if (!match || match.status !== 'finished' || match.homeScore == null || match.awayScore == null) return null;
  if (pred.home === match.homeScore && pred.away === match.awayScore) return POINTS_EXACT;
  return outcome(pred.home, pred.away) === outcome(match.homeScore, match.awayScore) ? POINTS_OUTCOME : 0;
}

/** Decides whether this run needs to call the football data API at all. */
export function shouldFetch({ now, today, state, matches }) {
  if (state.lastFullRefresh !== today) return true;
  return matches.some((m) => {
    if (m.status === 'live') return true;
    const untilKickoff = m.kickoff - now;
    return m.status === 'upcoming' && untilKickoff <= 20 * MINUTE && untilKickoff > -3 * HOUR;
  });
}
