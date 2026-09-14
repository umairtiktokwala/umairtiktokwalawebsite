// ============================================================
//  LEADERBOARD — PUBLIC
//
//  Safha yahan se data leta hai. Login ki zaroorat nahi.
//
//  Ye sirf EK document parhta hai — leaderboard/current — jo
//  leaderboard-build.js har ghante taiyar kar deta hai.
//
//  Is liye safha kitni bhi dafa khule, Firestore par bojh utna hi
//  rehta hai. 1,000 log ek saath khol dein to bhi 1,000 reads, na
//  ke 4,000,000.
//
//  Jo cheezein yahan se BAHAR nahi jatin:
//    phone number, uid, email, batch, koi bhi niji tafseel
//  Sirf naam, shehar aur percent — jo safhe par chhapa jata hai.
// ============================================================

import { getDb } from "./_firebase.js";

export default async function handler(req, res) {
  try {
    const db = getDb();
    const snap = await db.collection("leaderboard").doc("current").get();

    if (!snap.exists) {
      /* Cron abhi ek dafa bhi nahi chala */
      return res.status(200).json({
        ready: false,
        message: "The leaderboard is being prepared. Please check back soon."
      });
    }

    const d = snap.data() || {};

    /* Safha ko wahi bhejte hain jo dikhana hai — aur kuch nahi */
    return res.status(200).json({
      ready: true,
      updatedAt: d.updatedAt ? d.updatedAt.toDate().toISOString() : null,
      countFrom: d.countFrom || null,
      seats: d.seats || { free: 100, paid: 100 },
      /* `racing` aur `total` jaan boojh kar nahi bhejte — un se
         students ki kul tadaad public ho jati hai, jo karobari
         maloomat hai. Firestore mein wo mehfooz rehti hai, bas
         safhe tak nahi aati. */
      totals: {
        certified: d.totals?.certified || 0,
        seatsLeft: d.totals?.seatsLeft || 200
      },
      free: {
        certified: d.free?.certified || 0,
        top:       d.free?.top || []
      },
      paid: {
        certified: d.paid?.certified || 0,
        top:       d.paid?.top || []
      }
    });

  } catch (err) {
    console.error("LEADERBOARD READ ERROR:", err?.message || err);
    return res.status(500).json({ error: "Could not load the leaderboard" });
  }
}
