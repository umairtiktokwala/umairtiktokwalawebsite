// ============================================================
//  CERTIFICATE TEST — EK SAWAL KA JAWAB  (14 Sept 2026)
//
//  Har sawal par 30 second — SERVER ka waqt, browser ka nahi.
//
//  Kaise:
//    { attemptId, begin: true }
//        "Start the test" dabane par. Pehle sawal ka waqt ab se.
//
//    { attemptId, n, pick }
//        Sawal n (0 se) ka jawab pick (1-4, ya 0 = khali).
//        Server dekhta hai: ye wahi sawal hai jo saamne hai? Aur
//        pichle sawal se ab tak 33 second se kam guzre? Zyada guzre
//        to jawab KHALI ginta hai — chahe kuch bhi bheja ho.
//        Phir agla sawal shuru — us ka waqt ab se.
//
//  Wapas jane ka koi raasta nahi (n hamesha cur ke barabar hona
//  chahiye). Isi liye koi AI se poochh kar wapas nahi aa sakta.
//
//  Aakhri sawal ke baad `done: true` — phir safha cert-submit call
//  karta hai jo score banata hai (given se, browser se nahi).
// ============================================================

import { getDb } from "./_firebase.js";
import { getAuth } from "firebase-admin/auth";
import { Q_SECONDS, Q_GRACE } from "./cert-start.js";

const ms = t => (t && t.toMillis) ? t.toMillis() : (t instanceof Date ? t.getTime() : Number(t || 0));

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const db = getDb();

    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Not signed in" });

    let uid;
    try {
      uid = (await getAuth().verifyIdToken(token)).uid;
    } catch (e) {
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }

    const body = req.body || {};
    const attemptId = String(body.attemptId || "");
    if (!attemptId) return res.status(400).json({ error: "attemptId is required" });

    const ref = db.collection("certificateAttempts").doc(attemptId);
    const now = Date.now();
    const limit = (Q_SECONDS + Q_GRACE) * 1000;

    /* Transaction — do request ek saath aayein (double tap, do tab)
       to bhi ek sawal ek hi dafa aage barhe. */
    const out = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { error: "Attempt not found", code: 404 };
      const a = snap.data();
      if (a.uid !== uid) return { error: "Not your attempt", code: 403 };
      if (a.submittedAt) return { state: "already_submitted", done: true };

      const total = Number(a.total || (a.questions || []).length);
      const given = Array.isArray(a.given) ? a.given.slice() : new Array(total).fill(0);
      while (given.length < total) given.push(0);
      let cur = Number(a.cur || 0);
      let curAt = ms(a.curAt);

      /* ---- Start ---- */
      if (body.begin === true) {
        if (!curAt) {
          curAt = now;
          tx.update(ref, { curAt: new Date(now), begunAt: new Date(now) });
        }
        return { ok: true, cur, curAt, done: cur >= total };
      }

      if (!curAt) return { error: "Press Start first", code: 400 };

      /* ---- Pehle waqt se chhoote huay sawal khali gin lo ---- */
      let t = curAt;
      while (cur < total && now - t > limit) { given[cur] = 0; cur++; t += limit; }
      if (cur >= total) {
        tx.update(ref, { cur: total, curAt: new Date(t), given });
        return { ok: true, cur: total, curAt: t, done: true, late: true };
      }
      curAt = (t !== ms(a.curAt)) ? now : t;

      /* ---- Ye jawab ---- */
      const n = Number(body.n);
      if (!Number.isInteger(n) || n !== cur) {
        // Purana ya aage ka sawal — ignore, bas batao ab kahan hain
        return { ok: true, cur, curAt, done: false, resync: true };
      }
      let pick = parseInt(body.pick, 10);
      if (!(pick >= 1 && pick <= 4)) pick = 0;
      if (now - curAt > limit) pick = 0;       // der ho gayi — khali

      given[n] = pick;
      cur = n + 1;
      const nextAt = now;
      tx.update(ref, { given, cur, curAt: new Date(nextAt) });

      return { ok: true, cur, curAt: nextAt, done: cur >= total };
    });

    if (out.error) return res.status(out.code || 400).json({ error: out.error });
    return res.status(200).json({ ...out, now: Date.now(), qSeconds: Q_SECONDS });

  } catch (err) {
    console.error("CERT ANSWER ERROR:", err?.message || err);
    return res.status(500).json({ error: "Could not save your answer. Please try again." });
  }
}
