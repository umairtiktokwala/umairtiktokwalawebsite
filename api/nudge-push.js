// ============================================================
//  NUDGE PUSH
//
//  Jo student ghayab ho gaya hai us ke phone par ek yaad-dihani.
//  Vercel Cron rozana chalata hai (vercel.json mein set hai).
//
//  ---- SHART — teeno poori honi chahiyen ----
//
//  1. Student 7 din se portal nahi khola (lastSeen)
//  2. Course dekh hi nahi raha — 10% se kam (courseStats.pct)
//  3. Pichle 30 din mein us ko nudge nahi bheji
//
//  Doosri shart ahem hai. Jo student course dekh raha hai — chahe wo
//  ek hafte se na aaya ho — us ko kuch nahi jayega. Umair ne khud
//  yehi kaha tha: "agr kisi ne course dakh lia hai to phr nh jana
//  chahiye".
//
//  Teesri shart bhi utni hi ahem hai. Bina us ke wahi banda har hafte
//  tang hota rahega aur app uninstall kar dega.
//
//  ---- KHARCHA ----
//  Bilkul muft. WhatsApp par wahi kaam PKR 2.79 per message ka hota,
//  aur us ke liye Meta ka approved template bhi chahiye hota.
//
//  ---- JO CHHOOT JATE HAIN ----
//  Jis ne app install hi nahi ki, us ka fcmToken nahi hota — wo khud
//  chhoot jata hai. Suspended students bhi chhoot jate hain.
// ============================================================

import { getDb } from "./_firebase.js";
import { getMessaging } from "firebase-admin/messaging";

// Kitne din se ghayab ho to yaad dilayein
const GONE_DAYS = 7;

// Course kitna dekha ho to us ko chhoR dein
const PCT_LIMIT = 10;

// Ek bande ko dobara nudge bhejne se pehle itne din ka wait
const COOLDOWN_DAYS = 30;

// Ek dafa mein zyada se zyada itne — poori list ek saath bhejne se
// Vercel ka function waqt se pehle band ho sakta hai
const MAX_PER_RUN = 400;

// Firebase ki apni hadd
const CHUNK = 500;

const MESSAGES = [
  {
    title: "Aap ka course intezar kar raha hai",
    body: "Pehla lesson abhi shuru karein — dus minute kaafi hain."
  },
  {
    title: "Kahan reh gaye?",
    body: "Aap ka portal khula hai. Ek lesson dekh lein, silsila dobara chal paRega."
  },
  {
    title: "Aaj ek lesson?",
    body: "Jo shuru karte hain wo aage nikal jate hain. Portal khol kar dekh lein."
  }
];

function dayKey(d) {
  return d.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  // Sirf Vercel Cron ya sahi secret wala chala sake
  const secret = req.headers["x-cron-secret"] || req.query.secret;
  const isVercelCron = req.headers["user-agent"]?.includes("vercel-cron");

  if (!isVercelCron && secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Aazmane ke liye: ?dry=1 — kisi ko kuch nahi jayega, sirf ginti aayegi
  const dry = req.query.dry === "1";

  try {
    const db = getDb();
    const now = Date.now();

    const goneBefore = dayKey(new Date(now - GONE_DAYS * 864e5));
    const cooldownMs = COOLDOWN_DAYS * 864e5;

    const snap = await db.collection("students").get();

    const targets = [];
    let noToken = 0, active = 0, watching = 0, recentlyNudged = 0;

    snap.forEach(d => {
      if (targets.length >= MAX_PER_RUN) return;
      const s = d.data() || {};

      if (s.suspended === true) return;

      // 1. app install hi nahi ki
      if (!s.fcmToken) { noToken++; return; }

      // 2. course dekh raha hai — chhoR dein
      const pct = Number(s.courseStats?.pct || 0);
      if (pct >= PCT_LIMIT) { watching++; return; }

      // 3. haal hi mein aaya hai
      // lastSeen "2026-09-07" ki shakl mein hai, is liye seedha
      // moqabla ho jata hai
      const seen = String(s.lastSeen || "");
      if (seen && seen > goneBefore) { active++; return; }

      // 4. haal hi mein nudge ja chuki hai
      const last = s.lastNudgeAt?.toMillis ? s.lastNudgeAt.toMillis() : 0;
      if (last && now - last < cooldownMs) { recentlyNudged++; return; }

      targets.push({ uid: d.id, token: s.fcmToken });
    });

    if (dry) {
      return res.status(200).json({
        ok: true, dry: true,
        wouldSend: targets.length,
        skipped: { noToken, active, watching, recentlyNudged }
      });
    }

    if (!targets.length) {
      return res.status(200).json({
        ok: true, sent: 0,
        skipped: { noToken, active, watching, recentlyNudged }
      });
    }

    const messaging = getMessaging();
    const { FieldValue, Timestamp } = await import("firebase-admin/firestore");

    let sent = 0, failed = 0;
    const dead = [];
    const okUids = [];

    for (let i = 0; i < targets.length; i += CHUNK) {
      const slice = targets.slice(i, i + CHUNK);

      // Har batch ko alag paigham — sab ko ek hi jumla bhejna
      // machine jaisa lagta hai
      const m = MESSAGES[(i / CHUNK) % MESSAGES.length];

      const r = await messaging.sendEachForMulticast({
        tokens: slice.map(t => t.token),
        notification: { title: m.title, body: m.body },
        data: { title: m.title, body: m.body, tab: "course" },
        android: {
          priority: "high",
          notification: { channelId: "utw_general" }
        }
      });

      sent += r.successCount;
      failed += r.failureCount;

      r.responses.forEach((resp, idx) => {
        if (resp.success) { okUids.push(slice[idx].uid); return; }
        const code = resp.error?.code || "";
        if (
          code.includes("registration-token-not-registered") ||
          code.includes("invalid-registration-token") ||
          code.includes("invalid-argument")
        ) {
          dead.push(slice[idx].uid);
        }
      });
    }

    // Jin ko chali gayi — un par nishan, taake 30 din tak dobara na jaye
    const stamp = Timestamp.now();
    await Promise.all(
      okUids.map(uid =>
        db.collection("students").doc(uid)
          .set({ lastNudgeAt: stamp }, { merge: true })
          .catch(() => {})
      )
    );

    // Mare huay token hata dein
    await Promise.all(
      dead.map(uid =>
        db.collection("students").doc(uid)
          .set({ fcmToken: FieldValue.delete() }, { merge: true })
          .catch(() => {})
      )
    );

    return res.status(200).json({
      ok: true,
      sent,
      failed,
      cleaned: dead.length,
      skipped: { noToken, active, watching, recentlyNudged }
    });

  } catch (err) {
    console.error("NUDGE ERROR:", err?.message || err);
    return res.status(500).json({ error: "Nudge failed" });
  }
}
