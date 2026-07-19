// ============================================================
//  CLEANUP
//  7 din se purani chats delete kar deta hai (config mein badal sakte hain).
//  Vercel Cron rozana chalata hai — vercel.json mein set hai.
// ============================================================

import { getDb } from "./_firebase.js";
import { MESSAGE_RETENTION_DAYS } from "./_config.js";

export default async function handler(req, res) {
  // Sirf Vercel Cron ya sahi secret wala chala sake
  const secret = req.headers["x-cron-secret"] || req.query.secret;
  const isVercelCron = req.headers["user-agent"]?.includes("vercel-cron");

  if (!isVercelCron && secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const db = getDb();
    const cutoff = new Date(
      Date.now() - MESSAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000
    );

    let deletedMessages = 0;
    let deletedConvos = 0;

    const convos = await db.collection("conversations").get();

    for (const convo of convos.docs) {
      const old = await convo.ref
        .collection("messages")
        .where("timestamp", "<", cutoff)
        .limit(400)
        .get();

      if (!old.empty) {
        const batch = db.batch();
        old.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        deletedMessages += old.size;
      }

      // Agar koi message nahi bacha to conversation bhi hata dein
      const remaining = await convo.ref.collection("messages").limit(1).get();
      if (remaining.empty) {
        await convo.ref.delete();
        deletedConvos++;
      }
    }

    return res.status(200).json({
      ok: true,
      deletedMessages,
      deletedConvos,
      cutoff: cutoff.toISOString(),
    });
  } catch (err) {
    console.error("Cleanup error:", err);
    return res.status(500).json({ error: "Cleanup failed" });
  }
}
