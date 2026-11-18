/**
 * Kaweera push notifications (Web Push). Runs every 15 minutes from GitHub Actions:
 *  - Thursday from 10:00 Cairo: "The weekly contest is open" to everyone, once.
 *  - Results the owner confirmed in the Manager since the last run: "Your result was confirmed".
 *  - From 19:00 Cairo: a reminder to players whose streak would break tonight, once a day.
 *  - Breaking football news (ESPN): the newest big story, at most 4 a day between 09:00 and 23:00 Cairo,
 *    to devices that kept news alerts on.
 *  - New sign-ups, to the owner's Manager devices (`ownerPush/{device}`).
 * Subscriptions live in `pushSubs/{device}`; dead ones (404/410) are deleted. State: `config/pushState`.
 */
const NEWS_LEAGUES = ['uefa.champions', 'eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1'];
export const NEWS_PER_DAY = 4;

/** Newest stories across the big competitions (ESPN's public feed). */
export async function fetchNews(fetchImpl = fetch) {
  const lists = await Promise.allSettled(
    NEWS_LEAGUES.map(async (l) => {
      const r = await fetchImpl(`https://site.api.espn.com/apis/site/v2/sports/soccer/${l}/news?limit=5`);
      if (!r.ok) return [];
      const d = await r.json();
      return (d.articles ?? []).filter((a) => a.headline && a.links?.web?.href).map((a) => ({ id: String(a.id), headline: a.headline, url: a.links.web.href, published: Date.parse(a.published) || 0 }));
    }),
  );
  return lists.flatMap((x) => (x.status === 'fulfilled' ? x.value : [])).sort((a, b) => b.published - a.published);
}
export const APP_URL = 'https://doudoushehab2003-create.github.io/kaweera-by-sheebo/';
export const MANAGER_URL = APP_URL + 'manager/';
export const VAPID_PUBLIC = 'BM_tKzcUSi77nLqPPAFvFi6FvpCV7FYukgfTEBUP8j0unYMa6m_JJe8zKQoE3ftSfq5Wo-w9QvbQzsaobMdKwjQ';

const TEXT = {
  weekly: {
    en: ['🏆 The Thursday contest is open', 'One try, today only. Win a match ticket!'],
    ar: ['🏆 مسابقة الخميس بدأت', 'محاولة واحدة النهارده بس. اكسب تذكرة ماتش!'],
    fr: ['🏆 Le concours du jeudi est ouvert', "Un seul essai, aujourd'hui seulement. Gagnez une place de match !"],
  },
  confirmed: {
    en: ['✅ Result confirmed', (n) => `Your ${n} pts now count in this week's season.`],
    ar: ['✅ نتيجتك اتأكدت', (n) => `الـ ${n} نقطة بتوعك اتحسبوا في موسم الأسبوع.`],
    fr: ['✅ Résultat confirmé', (n) => `Vos ${n} pts comptent dans la saison de la semaine.`],
  },
  streak: {
    en: ['🔥 Keep your streak', (n) => `Play one game today to keep your ${n}-day streak and its token bonus.`],
    ar: ['🔥 حافظ على السلسلة', (n) => `العب ماتش واحد النهارده عشان سلسلة الـ ${n} يوم والبونص ما يضيعوش.`],
    fr: ['🔥 Gardez votre série', (n) => `Jouez une partie aujourd'hui pour garder votre série de ${n} jours.`],
  },
};
TEXT.news = { en: '📰 Football news', ar: '📰 أخبار الكورة', fr: '📰 Actu foot' };
const pick = (o, lang) => o[lang] ?? o.en;

export const cairoNow = (now = Date.now()) => {
  const t = now + 7_200_000;
  return { day: Math.floor(t / 86_400_000), hour: new Date(t).getUTCHours() };
};

export async function runPush({ db, send, now = Date.now(), news = fetchNews }) {
  const { day, hour } = cairoNow(now);
  const stateRef = db.doc('config/pushState');
  const state = (await stateRef.get()).data() ?? {};
  const subs = (await db.collection('pushSubs').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const out = { weekly: 0, confirmed: 0, streak: 0, news: 0, signups: 0, removed: 0 };

  const deliver = async (sub, title, body, url = APP_URL, coll = 'pushSubs') => {
    try {
      await send(JSON.parse(sub.sub), JSON.stringify({ title, body, url }));
      return true;
    } catch (e) {
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await db.doc(`${coll}/${sub.id}`).delete();
        out.removed++;
      } else console.warn('push failed', sub.id, e?.statusCode ?? e?.message);
      return false;
    }
  };
  const byUid = (uid) => subs.filter((s) => s.uid === uid);
  const next = {};

  // 1. Thursday (day % 7 == 0, as in the app) from 10:00.
  if (day % 7 === 0 && hour >= 10 && state.weeklyDay !== day) {
    for (const s of subs) {
      const [title, body] = pick(TEXT.weekly, s.lang);
      if (await deliver(s, title, body)) out.weekly++;
    }
    next.weeklyDay = day;
  }

  // 2. Results confirmed since the last run.
  const since = state.reviewedAt ?? now - 3_600_000;
  const confirmed = await db.collection('submissions').where('reviewedAt', '>', since).get();
  let latest = since;
  const points = new Map();
  for (const d of confirmed.docs) {
    const x = d.data();
    latest = Math.max(latest, x.reviewedAt);
    if (x.status === 'reviewed') points.set(x.uid, (points.get(x.uid) ?? 0) + (x.points ?? 0));
  }
  for (const [uid, n] of points) {
    for (const s of byUid(uid)) {
      const [title, body] = pick(TEXT.confirmed, s.lang);
      if (await deliver(s, title, body(n))) out.confirmed++;
    }
  }
  next.reviewedAt = latest;

  // 3. Streak reminder from 19:00 for streaks last played yesterday.
  if (hour >= 19 && state.streakDay !== day) {
    const due = await db.collection('streaks').where('day', '==', day - 1).get();
    for (const d of due.docs) {
      const { count } = d.data();
      if (count < 2) continue;
      for (const s of byUid(d.id)) {
        const [title, body] = pick(TEXT.streak, s.lang);
        if (await deliver(s, title, body(count))) out.streak++;
      }
    }
    next.streakDay = day;
  }

  // 4. Breaking news: the newest story from the last 45 minutes that hasn't been sent.
  const newsCount = state.newsDay === day ? state.newsCount ?? 0 : 0;
  if (hour >= 9 && hour < 23 && newsCount < NEWS_PER_DAY) {
    try {
      const sent = new Set(state.newsSent ?? []);
      const fresh = (await news()).find((n) => n.published > now - 45 * 60_000 && !sent.has(n.id));
      if (fresh) {
        for (const s of subs) {
          if (s.news === false) continue;
          if (await deliver(s, pick(TEXT.news, s.lang), fresh.headline, fresh.url)) out.news++;
        }
        next.newsSent = [fresh.id, ...(state.newsSent ?? [])].slice(0, 40);
        next.newsDay = day;
        next.newsCount = newsCount + 1;
      }
    } catch (e) {
      console.warn('news failed', e?.message);
    }
  }

  // 5. New sign-ups since the last run, to the owner's Manager devices.
  const usersSince = state.usersAt ?? now - 15 * 60_000;
  const fresh = (await db.collection('users').where('createdAt', '>', usersSince).get()).docs.map((d) => d.data());
  if (fresh.length) {
    const owners = (await db.collection('ownerPush').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
    const names = fresh.map((u) => u.name).filter(Boolean);
    const title = fresh.length === 1 ? '🆕 New player signed up' : `🆕 ${fresh.length} new players signed up`;
    const body = names.slice(0, 5).join(', ') + (names.length > 5 ? ` +${names.length - 5}` : '');
    for (const o of owners) if (await deliver(o, title, body, MANAGER_URL, 'ownerPush')) out.signups++;
    next.usersAt = Math.max(...fresh.map((u) => u.createdAt));
  } else next.usersAt = Math.max(usersSince, state.usersAt ?? 0);

  await stateRef.set(next, { merge: true });
  return out;
}
