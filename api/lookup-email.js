// ============================================================
//  LOOKUP EMAIL
//  Login ka "No account found" masla yahan khatam hota hai.
//
//  Browser pehle numbers/{number} dekhta hai. Agar wahan kuch na mile
//  to ye file chalti hai — Admin SDK se students collection mein
//  har shakal ka number check karti hai, aur jo entry ghayab thi
//  usay KHUD BANA DETI hai. Agli baar masla dobara nahi aayega.
//
//  Ye endpoint sirf wohi cheez batata hai jo numbers collection
//  pehle se sab ko batati hai (number ka email) — koi nayi
//  maloomat leak nahi hoti. Phir bhi rate limit lagi hui hai.
//
//  Koi nayi environment variable nahi chahiye.
// ============================================================

import { getDb } from "./_firebase.js";

// ---- Rate limit: koi number brute-force na kar sake ----
const HITS = new Map();
const LIMIT = 30;               // ek IP se 30 lookup
const WINDOW = 60 * 60 * 1000;  // har ghante

function overLimit(ip) {
  const now = Date.now();
  const rec = HITS.get(ip);
  if (!rec || now - rec.start > WINDOW) {
    HITS.set(ip, { start: now, n: 1 });
    return false;
  }
  rec.n += 1;
  if (HITS.size > 2000) HITS.clear();
  return rec.n > LIMIT;
}

// Number ki har mumkin shakal — matching ke liye
function numberShapes(digits) {
  const short = digits.slice(-10);
  return [...new Set([digits, "92" + short, short, "0" + short, "0092" + short, "+92" + short])];
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  if (overLimit(ip)) {
    return res.status(429).json({ error: "Bohat koshishein ho gayin. Thori der baad try karein." });
  }

  const raw = String((req.body || {}).number || "");
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) {
    return res.status(400).json({ error: "Number theek nahi lag raha." });
  }
  const short = digits.slice(-10);

  try {
    const db = getDb();

    // ---- 1. numbers collection — har shakal ki doc ID check karein ----
    for (const id of numberShapes(digits)) {
      try {
        const snap = await db.collection("numbers").doc(id).get();
        if (snap.exists) {
          const email = snap.data()?.email;
          if (email) {
            return res.status(200).json({ found: true, email: String(email).toLowerCase() });
          }
        }
      } catch (e) {
        // agli shakal try karein
      }
    }

    // ---- 2. students collection — phone10 se ----
    let studentDoc = null;
    try {
      const q = await db.collection("students").where("phone10", "==", short).limit(1).get();
      if (!q.empty) studentDoc = q.docs[0];
    } catch (e) {
      // aage barhein
    }

    // ---- 3. students collection — purana number field ----
    if (!studentDoc) {
      for (const val of numberShapes(digits)) {
        try {
          const q = await db.collection("students").where("number", "==", val).limit(1).get();
          if (!q.empty) { studentDoc = q.docs[0]; break; }
        } catch (e) {
          // agli shakal
        }
      }
    }

    if (!studentDoc) {
      return res.status(200).json({ found: false });
    }

    const data = studentDoc.data() || {};
    const email = data.email ? String(data.email).toLowerCase() : "";
    if (!email) {
      return res.status(200).json({ found: false });
    }

    // ---- 4. KHUD THEEK KAREIN — jo entry ghayab thi wo bana dein ----
    const healed = [];
    try {
      await db.collection("numbers").doc("92" + short).set(
        { email: email, healedAt: new Date() },
        { merge: true }
      );
      healed.push("numbers");
    } catch (e) {
      console.error("numbers heal failed:", e.message);
    }

    if (data.phone10 !== short) {
      try {
        await studentDoc.ref.update({ phone10: short });
        healed.push("phone10");
      } catch (e) {
        console.error("phone10 heal failed:", e.message);
      }
    }

    console.log("lookup-email repaired:", short, healed.join(","));
    return res.status(200).json({ found: true, email: email, repaired: healed });
  } catch (err) {
    console.error("lookup-email error:", err && err.message ? err.message : err);
    return res.status(503).json({ error: "Abhi check nahi ho saka. Thori der baad try karein." });
  }
}
