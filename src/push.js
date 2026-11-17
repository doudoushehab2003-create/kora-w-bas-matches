/**
 * Kaweera push notifications (Web Push). Runs every 15 minutes from GitHub Actions:
 *  - Thursday from 10:00 Cairo: "The weekly contest is open" to everyone, once.
 *  - Results the owner confirmed in the Manager since the last run: "Your result was confirmed".
 *  - From 19:00 Cairo: a reminder to players whose streak would break tonight, once a day.
 * Subscriptions live in `pushSubs/{device}`; dead ones (404/410) are deleted. State: `config/pushState`.
 */
export const APP_URL = 'https://doudoushehab2003-create.github.io/kaweera-by-sheebo/';
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
const pick = (o, lang) => o[lang] ?? o.en;

export const cairoNow = (now = Date.now()) => {
  const t = now + 7_200_000;
  return { day: Math.floor(t / 86_400_000), hour: new Date(t).getUTCHours() };
};

export async function runPush({ db, send, now = Date.now() }) {
  const { day, hour } = cairoNow(now);
  const stateRef = db.doc('config/pushState');
  const state = (await stateRef.get()).data() ?? {};
  const subs = (await db.collection('pushSubs').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const out = { weekly: 0, confirmed: 0, streak: 0, removed: 0 };

  const deliver = async (sub, title, body) => {
    try {
      await send(JSON.parse(sub.sub), JSON.stringify({ title, body, url: APP_URL }));
      return true;
    } catch (e) {
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await db.doc(`pushSubs/${sub.id}`).delete();
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

  await stateRef.set(next, { merge: true });
  return out;
}
