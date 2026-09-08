// ============================================================
//  CERTIFICATE TEST — JAWAB JAMA KARNA
//
//  Student ke jawab yahan aate hain. Jaanch SERVER PAR hoti hai —
//  jawab kabhi browser tak nahi jate, is liye koi apna score nahi
//  badal sakta.
//
//  Paas ho jaye to certificates/{uid} ban jata hai. Wo record kabhi
//  badalta nahi — na student, na admin. Rules mein bhi band hai.
// ============================================================

import { getDb } from "./_firebase.js";
import { getAuth } from "firebase-admin/auth";

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

    const { attemptId, answers } = req.body || {};
    if (!attemptId || !Array.isArray(answers)) {
      return res.status(400).json({ error: "attemptId and answers are required" });
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

    /* ---- Jaanch ---- */
    const key = a.answers || [];
    let score = 0;
    const wrong = [];

    key.forEach((right, i) => {
      const given = Number(answers[i] || 0);
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

    /* ---- Paas — certificate bana dete hain ---- */
    if (passed) {
      const s = await db.collection("students").doc(uid).get();
      const d = s.data() || {};

      /* Number aisa jo dohra na ho aur padha ja sake.
         Misaal: UTW-2026-4F7K2 */
      const y = new Date().getFullYear();
      const rnd = Math.random().toString(36).slice(2, 7).toUpperCase();
      const certNo = "UTW-" + y + "-" + rnd;

      await db.collection("certificates").doc(uid).set({
        uid,
        certNo,
        name: d.name || "",
        number: d.number || "",
        batch: (d.batches || [])[0] || "",
        score, total, pct,
        attemptId: String(attemptId),
        issuedAt: FieldValue.serverTimestamp()
      }, { merge: false });

      /* Student ko portal mein itlaa */
      const nid = db.collection("notifications").doc();
      await nid.set({
        studentUid: uid,
        studentName: d.name || "",
        title: "Certificate issued",
        message: "You passed the certificate test with " + score + "/" + total
               + ". Your certificate number is " + certNo + ".",
        isRead: false,
        isArchived: false,
        createdAt: FieldValue.serverTimestamp()
      });

      return res.status(200).json({
        state: "passed", score, total, pct, certNo, wrong
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
