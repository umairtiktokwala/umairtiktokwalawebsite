// ============================================================
//  CERTIFICATE — PUBLIC SAFHE KI IJAZAT
//
//  Student khud faisla karta hai ke us ka naam certified students
//  wale public safhe par aaye ya nahi.
//
//  ---- STUDENT KHUD KYUN NAHI LIKH SAKTA ----
//  certificates par rules mein `allow write: if false` hai — koi
//  bhi kuch nahi badal sakta, admin bhi nahi. Wajah: certificate ka
//  matlab hi yehi hai ke wo us waqt ka sach hai aur baad mein chheRa
//  nahi gaya.
//
//  Is liye ijazat wala faisla bhi yahin se likha jata hai, aur ye
//  API SIRF `featured` ko haath lagati hai. Naam, score, certificate
//  number — kisi ko chhu bhi nahi sakti.
// ============================================================

import { getDb } from "./_firebase.js";
import { getAuth } from "firebase-admin/auth";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    /* getDb() PEHLE — wahi Firebase app initialize karta hai.
       getAuth() us se pehle chale to verifyIdToken nakaam ho jata hai. */
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

    const yes = req.body?.featured;
    if (yes !== true && yes !== false) {
      return res.status(400).json({ error: "featured must be true or false" });
    }

    const ref = db.collection("certificates").doc(uid);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ error: "No certificate found for this account" });
    }

    /* Sirf ye ek khana. Baqi kuch nahi badalta. */
    await ref.update({ featured: yes });

    return res.status(200).json({ ok: true, featured: yes });

  } catch (err) {
    console.error("CERT FEATURE ERROR:", err?.message || err);
    return res.status(500).json({ error: "Could not save your choice. Please try again." });
  }
}
