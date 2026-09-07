// ============================================================
//  WHATSAPP BLOCK / UNBLOCK
//
//  Badtameezi karne wale ko support inbox se rok dene ke liye.
//  Block ke baad:
//    - Wo aap ko message nahi bhej sakta
//    - Wo ye nahi dekh sakta ke aap online hain
//    - Aap bhi us ko message nahi bhej sakte
//    - Us ko koi itlaa nahi jati (khamoshi se hota hai)
//
//  ---- META KI SHART (is ko badla nahi ja sakta) ----
//  Sirf wahi banda block ho sakta hai jis ne PICHLE 24 GHANTE mein
//  message kiya ho. Purani chat kholkar block nahi kar sakte.
//  Meta is soorat mein error 131047 deta hai.
//
//  Block usi number par lagta hai jis par us ne message kiya tha —
//  is liye chat ka phoneNumberId istemal hota hai, env wala nahi.
//  (Wahi sabaq jo reply bhejte waqt seekha tha.)
//
//  Haddein: ek request mein 1,000 log, kul blocklist 64,000.
// ============================================================

import { getDb } from "./_firebase.js";

const GRAPH = "https://graph.facebook.com/v21.0";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { convoId, waNumber, phoneNumberId, action, by, byName } = req.body || {};

  if (!convoId || !waNumber) {
    return res.status(400).json({ error: "convoId and waNumber are required" });
  }
  if (action !== "block" && action !== "unblock") {
    return res.status(400).json({ error: "action must be 'block' or 'unblock'" });
  }

  const fromId = phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
  const endpoint = action === "block" ? "block_users" : "unblock_users";
  const url = `${GRAPH}/${fromId}/${endpoint}`;

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        block_users: [{ user: String(waNumber) }],
      }),
    });

    const data = await r.json();

    // Meta har number ka alag nateeja deta hai — kuch kaamyab, kuch nakaam.
    const failed = data?.[endpoint]?.failed_users || [];
    const added  = data?.[endpoint]?.added_users || data?.[endpoint]?.removed_users || [];

    if (!r.ok || (failed.length && !added.length)) {
      const detail = failed[0]?.errors?.[0] || {};
      const code = detail.code || data?.error?.code;

      // 131047 = 24-ghante wali shart poori nahi hui
      let msg = detail.error_message || detail.title || data?.error?.message || "Meta refused the request";
      if (code === 131047) {
        msg = "This person has not messaged in the last 24 hours — Meta only allows blocking within that window. Block them when their next message arrives.";
      } else if (code === 139101) {
        msg = "The blocklist is full (64,000 limit).";
      }

      console.error("Block failed:", JSON.stringify(data));
      return res.status(200).json({ ok: false, error: msg, code });
    }

    // Firestore mein nishan — taake dashboard mein halat dikhe
    try {
      const db = getDb();
      await db.collection("conversations").doc(String(convoId)).set(
        action === "block"
          ? { blocked: true, blockedAt: new Date(), blockedBy: by || null, blockedByName: byName || null }
          : { blocked: false, unblockedAt: new Date(), unblockedBy: by || null, unblockedByName: byName || null },
        { merge: true }
      );
    } catch (e) {
      console.log("Firestore nishan nahi laga:", e.message);
    }

    return res.status(200).json({ ok: true, action });

  } catch (err) {
    console.error("BLOCK ERROR:", err?.message || err);
    return res.status(200).json({ ok: false, error: "The request failed. Please try again." });
  }
}
