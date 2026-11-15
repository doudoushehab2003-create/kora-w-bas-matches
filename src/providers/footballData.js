const BASE = 'https://api.football-data.org/v4';

const STATUS = {
  SCHEDULED: 'upcoming',
  TIMED: 'upcoming',
  IN_PLAY: 'live',
  PAUSED: 'live',
  FINISHED: 'finished',
  AWARDED: 'finished',
  POSTPONED: 'postponed',
  SUSPENDED: 'postponed',
  CANCELLED: 'postponed',
};

/** Turns one football-data.org match into the shape stored in Firestore, or null if it has no teams yet. */
export function normalizeMatch(m) {
  const home = m.homeTeam?.shortName || m.homeTeam?.name;
  const away = m.awayTeam?.shortName || m.awayTeam?.name;
  const kickoff = Date.parse(m.utcDate);
  if (!home || !away || Number.isNaN(kickoff)) return null;
  return {
    id: `fd${m.id}`,
    provider: 'football-data',
    competition: m.competition?.name ?? '',
    competitionCode: m.competition?.code ?? '',
    home,
    away,
    homeCrest: m.homeTeam?.crest ?? '',
    awayCrest: m.awayTeam?.crest ?? '',
    kickoff,
    status: STATUS[m.status] ?? 'upcoming',
    homeScore: m.score?.fullTime?.home ?? null,
    awayScore: m.score?.fullTime?.away ?? null,
  };
}

export async function fetchMatches({ token, dateFrom, dateTo, fetchImpl = fetch }) {
  const res = await fetchImpl(`${BASE}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`, {
    headers: { 'X-Auth-Token': token },
  });
  if (!res.ok) throw new Error(`football-data.org returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return (json.matches ?? []).map(normalizeMatch).filter(Boolean);
}
