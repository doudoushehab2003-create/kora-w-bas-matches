/** Builds the daily "new players" email. Only usernames and emails: passwords are never available or sent. */
export function buildDigest(users, sinceMs, untilMs) {
  const fresh = users
    .filter((u) => typeof u.createdAt === 'number' && u.createdAt >= sinceMs && u.createdAt < untilMs)
    .sort((a, b) => a.createdAt - b.createdAt);
  if (fresh.length === 0) return null;
  const lines = fresh.map((u) => `- ${u.name} <${u.email}> (${new Date(u.createdAt).toISOString()})`);
  return {
    subject: `Kaweera: ${fresh.length} new ${fresh.length === 1 ? 'player' : 'players'} in the last 24 hours`,
    text: `New accounts:\n\n${lines.join('\n')}\n\nPasswords are never stored in readable form, so they are not included.`,
  };
}

export async function runDigest({ db, sendMail, now = Date.now() }) {
  const since = now - 24 * 60 * 60 * 1000;
  const snap = await db.collection('users').where('createdAt', '>=', since).where('createdAt', '<', now).get();
  const digest = buildDigest(snap.docs.map((d) => d.data()), since, now);
  if (!digest) return { sent: false, count: 0 };
  await sendMail(digest);
  return { sent: true, count: snap.size };
}
