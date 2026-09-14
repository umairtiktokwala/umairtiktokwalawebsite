// ============================================================
//  LEADERBOARD — HISAAB LAGANE WALA (CRON)
//
//  Har ghante chalta hai. Sab students ka progress ginta hai aur
//  ek hi jagah likh deta hai: leaderboard/current
//
//  ---- AISA KYUN ----
//  1,060 students hain. Har ek ke liye Firestore se parhna paRta hai:
//    student ka record, days ki subcollection, submissions, investments
//
//  Yaani har student par 4 queries = 4,000+ reads. Agar ye har dafa
//  safha khulne par chale to:
//    - safha der se khulega
//    - Firestore ka bill barh jayega
//    - aur 100 log ek saath khol dein to 400,000 reads
//
//  Is liye ye kaam ghante mein EK DAFA hota hai, aur us ka nateeja
//  ek document mein likh diya jata hai. Safha sirf wo ek document
//  parhta hai.
//
//  ---- VERCEL MEIN ----
//  vercel.json ke crons mein:
//    { "path": "/api/leaderboard-build", "schedule": "0 * * * *" }
//
//  CRON_SECRET se mehfooz hai.
// ============================================================

import { getDb } from "./_firebase.js";
import { FieldPath } from "firebase-admin/firestore";

/* Wahi hadd jo cert-start.js mein hain — dono jagah barabar rehni
   chahiyen, warna student ko do alag number nazar aayenge. */
const NEED_HOURS = 50;
const NEED_DAYS  = 30;
const NEED_PCT   = 100;
const DAY_MIN    = 10 * 60;          // ek din ginne ke liye 10 minute
const COUNT_FROM = "2026-09-13";     // scholarship ka counter

/* Har shart ka hissa — kul 100.

   Course, ghante aur din sab se bhaari hain kyunke wahi asal mehnat
   hain. Profile aur platform chunna chhote kaam hain, is liye kam. */
const WEIGHTS = {
  course:    25,
  hours:     20,
  days:      20,
  task:      10,
  profile:   10,
  invest:     5,
  platform:   5,
  test:       5,
};

const TOP = 50;   // har fehrist mein kitne naam

export default async function handler(req, res) {
  /* Sirf cron chala sake — koi aur URL khol kar na chalaye */
  const secret = process.env.CRON_SECRET;
  const given  = (req.headers.authorization || "").replace(/^Bearer\s+/i, "")
               || req.query.key || "";
  if (secret && given !== secret) {
    return res.status(401).json({ error: "Not allowed" });
  }

  try {
    const db = getDb();
    const started = Date.now();

    /* ---- Sab kuch ek saath uthao ----
       Har student ke liye alag query karna dhima hai. Teen collections
       poori uthate hain aur uid ke hisaab se baant lete hain. */
    const [studSnap, subSnap, invSnap, certSnap] = await Promise.all([
      db.collection("students").get(),
      db.collection("submissions").where("status", "==", "approved").get(),
      db.collection("investments").get(),
      db.collection("certificates").get(),
    ]);

    const hasTask   = new Set();
    subSnap.forEach(d => { const u = d.data()?.uid; if (u) hasTask.add(u); });

    const hasInvest = new Set();
    invSnap.forEach(d => { const u = d.data()?.uid; if (u) hasInvest.add(u); });

    const certified = new Set();
    certSnap.forEach(d => certified.add(d.id));

    /* ---- Har student ka hisaab ----

       AHEM: pehle ye loop `days` ki subcollection EK EK KAR KE parhta
       tha — 1,060 dafa, ek ke baad ek. Har call par 50-100ms lagte
       hain, to kul 60-100 second — aur Vercel ka function us se pehle
       hi waqt khatam kar deta tha (logs mein status "---" aata tha).

       Ab 60 students ek saath parhte hain. 1,060 ke liye ~18 chakkar
       lagte hain, aur kaam 5-8 second mein ho jata hai.

       60 se zyada ek saath karne se Firestore rok deta hai. */
    const rows = [];
    const CHUNK = 60;

    const docs = studSnap.docs.filter(doc => {
      const s = doc.data() || {};
      if (s.suspended === true) return false;
      return String(s.name || "").trim().length > 0;
    });

    for (let i = 0; i < docs.length; i += CHUNK) {
      const slice = docs.slice(i, i + CHUNK);
      await Promise.all(slice.map(doc => one(doc)));
    }

    async function one(doc) {
      const uid = doc.id;
      const s = doc.data() || {};
      const name = String(s.name || "").trim();

      // 1. Course
      const pct = Number(s.courseStats?.pct || 0);
      const cCourse = Math.min(pct / NEED_PCT, 1);

      // 2. Task
      const cTask = hasTask.has(uid) ? 1 : 0;

      // 3. Profile
      const hasName  = name.length >= 3;
      const hasCity  = String(s.city || "").trim().length >= 2;
      const hasPhoto = String(s.photo || s.photoURL || "").trim().length > 0;
      const cProfile = (hasName + hasCity + hasPhoto) / 3;

      /* 4 + 5. Ghante aur din.

         Sirf COUNT_FROM ke baad wale din uthate hain — document ki ID
         hi tareekh hai (2026-09-13 ki shakl mein), is liye Firestore
         se seedha maang sakte hain. Us se purane mahinon ke documents
         network par aate hi nahi. */
      let seconds = 0, activeDays = 0;
      try {
        let q = doc.ref.collection("days");
        if (COUNT_FROM) q = q.where(FieldPath.documentId(), ">=", COUNT_FROM);
        const daysSnap = await q.get();
        daysSnap.forEach(d => {
          const n = Number(d.data()?.seconds || 0);
          if (n > 0) seconds += n;
          if (n >= DAY_MIN) activeDays++;
        });
      } catch (e) { /* days na ho to sifar */ }

      const hours  = seconds / 3600;
      const cHours = Math.min(hours / NEED_HOURS, 1);
      const cDays  = Math.min(activeDays / NEED_DAYS, 1);

      // 6. Investment
      const cInvest = hasInvest.has(uid) ? 1 : 0;

      // 7. Platform chuna
      const cPlatform = (s.workPlatform === "facebook" || s.workPlatform === "tiktok") ? 1 : 0;

      // 8. Test paas
      const isCertified = certified.has(uid);
      const cTest = isCertified ? 1 : 0;

      const score =
        cCourse   * WEIGHTS.course   +
        cHours    * WEIGHTS.hours    +
        cDays     * WEIGHTS.days     +
        cTask     * WEIGHTS.task     +
        cProfile  * WEIGHTS.profile  +
        cInvest   * WEIGHTS.invest   +
        cPlatform * WEIGHTS.platform +
        cTest     * WEIGHTS.test;

      /* Jis ne abhi kuch shuru hi nahi kiya wo fehrist mein na aaye —
         warna safha sifar wale naamon se bhar jata hai */
      if (score < 1) return;

      /* Free ya paid — wahi mantiq jo admin dashboard mein hai */
      const batches = Array.isArray(s.batches) ? s.batches : [];
      const isFree = batches.includes("Free") && s.verified !== true;

      rows.push({
        name,
        city: String(s.city || "").trim(),
        pct: Math.round(score),
        certified: isCertified,
        /* Jis ne apna naam chhupaya ho — naam ki jagah "A student" */
        hidden: s.hideFromLeaderboard === true,
        group: isFree ? "free" : "paid",
      });
    }

    /* ---- Do fehristein ---- */
    const mk = (g) => {
      const list = rows.filter(r => r.group === g)
        .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));
      return {
        total:     list.length,
        certified: list.filter(r => r.certified).length,
        top: list.slice(0, TOP).map((r, i) => ({
          rank: i + 1,
          /* Naam chhupane wale ka naam nahi jata — magar wo ginti
             mein shamil rehta hai aur us ki jagah bhi rehti hai */
          name: r.hidden ? "A student" : r.name,
          city: r.hidden ? "" : r.city,
          pct:  r.pct,
          certified: r.certified,
        })),
      };
    };

    const free = mk("free");
    const paid = mk("paid");

    const payload = {
      updatedAt: new Date(),
      countFrom: COUNT_FROM,
      seats: { free: 100, paid: 100 },
      free,
      paid,
      totals: {
        racing:    free.total + paid.total,
        certified: free.certified + paid.certified,
        seatsLeft: (100 - free.certified) + (100 - paid.certified),
      },
      builtInMs: Date.now() - started,
    };

    await db.collection("leaderboard").doc("current").set(payload);

    console.log("LEADERBOARD:", payload.totals.racing, "students,",
                payload.builtInMs, "ms");

    return res.status(200).json({ ok: true, ...payload.totals,
                                  ms: payload.builtInMs });

  } catch (err) {
    console.error("LEADERBOARD BUILD ERROR:", err?.message || err);
    return res.status(500).json({ error: "Could not build the leaderboard" });
  }
}
