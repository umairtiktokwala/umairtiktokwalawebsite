// ============================================================
//  PUSH NOTIFICATION
//
//  Student ke phone par paigham bhejta hai. Teen tareeqe:
//
//    1. { uid, title, body }
//       Ek student ko — task ka jawab, message waghera
//
//    2. { batch, title, body }
//       Poori batch ko — "naya lesson aa gaya"
//
//    3. { all: true, title, body }
//       Sab students ko — kam istemal karein
//
//  ---- KHARCHA ----
//  Firebase Cloud Messaging bilkul MUFT hai, koi hadd nahi.
//  WhatsApp par ek message PKR 2.79 ka hota hai.
//
//  ---- TOKEN KAHAN SE ----
//  App login ke baad students/{uid} mein fcmToken likh deti hai.
//  Jis student ne app install hi nahi ki, us ka token nahi hota —
//  wo khud chhoot jata hai, koi error nahi.
//
//  ---- PURANE TOKEN ----
//  Student app uninstall kar de to token mar jata hai. Firebase
//  us par "not registered" ka error deta hai. Aise token hum khud
//  Firestore se hata dete hain, warna wo hamesha jama rehte hain.
// ============================================================

import { getDb } from "./_firebase.js";
import { getMessaging } from "firebase-admin/messaging";

// Ek dafa mein zyada se zyada itne token — Firebase ki apni hadd 500 hai
const CHUNK = 500;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { uid, batch, all, title, body, tab, secret } = req.body || {};

  // Dashboard se aane wali request par secret nahi hota (wo login ke
  // peeche hai). Cron ya kisi aur server se aaye to secret lazmi.
  if (secret && secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!title || !body) {
    return res.status(400).json({ error: "title and body are required" });
  }
  if (!uid && !batch && !all) {
    return res.status(400).json({ error: "one of uid, batch or all is required" });
  }

  try {
    const db = getDb();
    const tokens = [];
    const tokenOwner = {};   // token -> uid, purana token hatane ke liye

    if (uid) {
      const snap = await db.collection("students").doc(String(uid)).get();
      const t = snap.exists ? snap.data().fcmToken : null;
      if (t) { tokens.push(t); tokenOwner[t] = snap.id; }
    } else {
      // batch ya sab
      let q = db.collection("students");
      if (batch) q = q.where("batches", "array-contains", String(batch));
      const snap = await q.get();
      snap.forEach(d => {
        const t = d.data().fcmToken;
        if (t) { tokens.push(t); tokenOwner[t] = d.id; }
      });
    }

    if (!tokens.length) {
      return res.status(200).json({
        ok: true, sent: 0, failed: 0,
        note: "No phones found — these students have not installed the app yet."
      });
    }

    const messaging = getMessaging();
    let sent = 0, failed = 0;
    const dead = [];

    for (let i = 0; i < tokens.length; i += CHUNK) {
      const slice = tokens.slice(i, i + CHUNK);

      const r = await messaging.sendEachForMulticast({
        tokens: slice,
        // notification + data dono — app band ho to Android khud dikhata
        // hai, khuli ho to PushService dikhati hai
        notification: { title: String(title), body: String(body) },
        data: {
          title: String(title),
          body: String(body),
          tab: tab ? String(tab) : ""
        },
        android: {
          priority: "high",
          notification: { channelId: "utw_general" }
        }
      });

      sent += r.successCount;
      failed += r.failureCount;

      r.responses.forEach((resp, idx) => {
        if (resp.success) return;
        const code = resp.error?.code || "";
        // Token mar chuka hai — app uninstall ho gayi ya token badal gaya
        if (
          code.includes("registration-token-not-registered") ||
          code.includes("invalid-registration-token") ||
          code.includes("invalid-argument")
        ) {
          dead.push(slice[idx]);
        }
      });
    }

    // Mare huay token hata dein — warna hamesha jama rehte hain aur
    // har dafa nakaam hote rehte hain
    if (dead.length) {
      const { FieldValue } = await import("firebase-admin/firestore");
      await Promise.all(
        dead.map(t => {
          const owner = tokenOwner[t];
          if (!owner) return Promise.resolve();
          return db.collection("students").doc(owner)
            .set({ fcmToken: FieldValue.delete() }, { merge: true })
            .catch(() => {});
        })
      );
    }

    return res.status(200).json({
      ok: true,
      sent,
      failed,
      cleaned: dead.length
    });

  } catch (err) {
    console.error("PUSH ERROR:", err?.message || err);
    return res.status(200).json({
      ok: false,
      error: "Could not send the notification. Please try again."
    });
  }
}
