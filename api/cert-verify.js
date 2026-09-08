// ============================================================
//  CERTIFICATE — TASDEEQ
//
//  Koi bhi certificate number daal kar dekh sakta hai ke wo asli hai
//  ya nahi. Login ki zaroorat nahi.
//
//  ---- YE API KYUN CHAHIYE ----
//  certificates collection par rules kehte hain: sirf wahi student
//  parh sakta hai jis ka certificate hai, ya admin. Yaani koi bahar
//  ka banda seedha Firestore se nahi parh sakta — aur ye theek hai.
//
//  Lekin tasdeeq ke liye bahar ke bande ko bhi dekhna chahiye. Is
//  liye ye API Admin SDK istemal karti hai (jo rules bypass karta
//  hai) aur SIRF WO CHEEZEIN bhejti hai jo certificate par likhi
//  hoti hain.
//
//  Jo nahi bhejta: uid, phone number, attemptId — kuch bhi niji.
// ============================================================

import { getDb } from "./_firebase.js";

export default async function handler(req, res) {
  const no = String(
    (req.query && req.query.no) || (req.body && req.body.certNo) || ""
  ).trim().toUpperCase();

  if (!no || no.length < 6 || no.length > 40) {
    return res.status(400).json({ error: "Certificate number is required" });
  }

  try {
    const db = getDb();
    const snap = await db.collection("certificates")
      .where("certNo", "==", no).limit(1).get();

    if (snap.empty) {
      return res.status(200).json({ found: false });
    }

    const c = snap.docs[0].data();

    /* Sirf wahi jo certificate par chhapa hota hai */
    return res.status(200).json({
      found: true,
      certNo: c.certNo,
      name:   c.name || "",
      batch:  c.batch || "",
      score:  c.score,
      total:  c.total,
      pct:    c.pct,
      issuedAt: c.issuedAt ? c.issuedAt.toDate().toISOString() : null
    });

  } catch (err) {
    console.error("CERT VERIFY ERROR:", err?.message || err);
    return res.status(500).json({ error: "Could not check this number. Please try again." });
  }
}
