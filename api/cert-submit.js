// ============================================================
//  CERTIFICATE TEST — JAWAB JAMA KARNA
//
//  Student ke jawab yahan aate hain. Jaanch SERVER PAR hoti hai —
//  jawab kabhi browser tak nahi jate, is liye koi apna score nahi
//  badal sakta.
//
//  14 Sept 2026: paas hone par certificate NAHI banta. Student link
//  deta hai (cert-work.js), team dekhti hai (cert-review.js), Approve
//  par certificate banta hai. cleanBatch/pickBatch wahan istemal hote
//  hain — is liye yahan se export hain.
// ============================================================

import { getDb } from "./_firebase.js";
import { getAuth } from "firebase-admin/auth";

/* Batch ka naam saaf karna — certificate par chhapta hai (14 Sept 2026).

   Sheet se batch teen shakloon mein aata hai:
     "July-2026"                          — theek
     "2026-07-01T07:00:00.000Z"           — Google ka date
     "Wed Jul 01 2026 ... (Pakistan Standard Time)"
   Pehle jo bhi pehla batch tha wahi chhap jata tha — yaani certificate
   par "2026 07 01T07:00:00.000Z" bhi aa sakta tha.

   Ab: paid batch pehle (Free nahi), aur naam "July-2026" ki shakl mein. */
const MONTHS = ["January","February","March","April","May","June","July",
                "August","September","October","November","December"];
export function cleanBatch(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  // pehle se saaf: "July-2026" / "July 2026"
  const m1 = s.match(/^([A-Za-z]+)[-\s]?(20\d{2})$/);
  if (m1) return m1[1] + "-" + m1[2];
  // ISO date: 2026-07-01T...
  const m2 = s.match(/^(20\d{2})-(\d{2})-\d{2}/);
  if (m2) { const mi = parseInt(m2[2], 10) - 1; if (MONTHS[mi]) return MONTHS[mi] + "-" + m2[1]; }
  // "Wed Jul 01 2026 ..." ya koi aur shakl jis mein mahina aur saal ho
  const mm = s.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/i);
  const yy = s.match(/\b(20\d{2})\b/);
  if (mm && yy) {
    const full = MONTHS.find(x => x.slice(0, 3).toLowerCase() === mm[1].slice(0, 3).toLowerCase());
    if (full) return full + "-" + yy[1];
  }
  return s;
}
export function pickBatch(batches) {
  const arr = Array.isArray(batches) ? batches.map(cleanBatch).filter(Boolean) : [];
  if (!arr.length) return "";
  const paid = arr.filter(b => !/^free$/i.test(b) && !/paypal/i.test(b));
  return (paid.length ? paid[paid.length - 1] : arr[0]);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    /* AHEM: getDb() PEHLE. Wahi Firebase app ko initialize karta hai.
       Agar getAuth() us se pehle chale to app maujood hi nahi hoti aur
       verifyIdToken nakaam ho jata hai — har bande ko "Session expired"
       milta hai chahe wo abhi abhi login hua ho. */
    const db = getDb();

    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Not signed in" });

    let uid;
    try {
      uid = (await getAuth().verifyIdToken(token)).uid;
    } catch (e) {
      console.error("TOKEN FAIL:", e?.message || e);
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }

    const { attemptId } = req.body || {};
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    if (!attemptId) {
      return res.status(400).json({ error: "attemptId is required" });
    }

    const ref = db.collection("certificateAttempts").doc(String(attemptId));
    const snap = await ref.get();

    if (!snap.exists) return res.status(404).json({ error: "Attempt not found" });
    const a = snap.data();

    /* Kisi doosre ka test jama nahi kar sakte */
    if (a.uid !== uid) return res.status(403).json({ error: "Not your attempt" });

    /* Ek dafa jama ho gaya to dobara nahi — warna student baar baar
       bhej kar sahi jawab talash kar leta */
    if (a.submittedAt) {
      return res.status(200).json({
        state: "already_submitted",
        score: a.score, total: a.total, passed: a.passed
      });
    }

    /* ---- Jaanch ----
       14 Sept 2026: jawab attempt ke `given` se — jo cert-answer.js ne
       server ke waqt ke saath likhe. Browser se aaye `answers` sirf tab
       jab `given` maujood na ho (purane attempts). */
    const key = a.answers || [];
    const src = Array.isArray(a.given) && a.given.length ? a.given : answers;
    let score = 0;
    const wrong = [];

    key.forEach((right, i) => {
      const given = Number(src[i] || 0);
      if (given === right) score++;
      else wrong.push({
        n: i + 1,
        q: a.questions?.[i]?.q || "",
        picked: given >= 1 ? (a.questions?.[i]?.opts?.[given - 1] || "") : "",
        right: a.questions?.[i]?.opts?.[right - 1] || ""
      });
    });

    const total = key.length;
    const pct = total ? Math.round(score / total * 100) : 0;
    const passed = pct >= Number(a.passPct || 70);

    const { FieldValue } = await import("firebase-admin/firestore");
    await ref.update({
      submittedAt: FieldValue.serverTimestamp(),
      score, total, pct, passed,
      wrongCount: wrong.length
    });

    /* ---- Paas — magar certificate ABHI NAHI (14 Sept 2026) ----
       Student ab apne account ka link deta hai (api/cert-work), team
       dekhti hai (api/cert-review). Approve par wahin certificate banta
       hai. Yahan sirf student ko itlaa. */
    if (passed) {
      const s = await db.collection("students").doc(uid).get();
      const d = s.data() || {};

      const nid = db.collection("notifications").doc();
      await nid.set({
        studentUid: uid,
        studentName: d.name || "",
        title: "You passed the certificate test",
        message: "You scored " + score + "/" + total + ". One last step: open the Certificate "
               + "page and share the link to your " + (a.platform === "tiktok" ? "TikTok" : "Facebook")
               + " account so our team can review it.",
        isRead: false,
        isArchived: false,
        createdAt: FieldValue.serverTimestamp()
      });

      return res.status(200).json({
        state: "passed", score, total, pct, wrong, platform: a.platform || d.workPlatform || ""
      });
    }

    /* ---- Fail ---- */
    const all = await db.collection("certificateAttempts")
      .where("uid", "==", uid).get();
    let used = 0;
    all.forEach(d => { const x = d.data(); if (x.submittedAt && !x.retired) used++; });

    return res.status(200).json({
      state: "failed",
      score, total, pct,
      attemptsUsed: used,
      wrong
    });

  } catch (err) {
    console.error("CERT SUBMIT ERROR:", err?.message || err);
    return res.status(500).json({ error: "Could not save your answers. Please try again." });
  }
}
