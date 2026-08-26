// ============================================================
//  SEND MESSAGE
//  Dashboard yahan reply bhejta hai, ye Meta tak pohanchata hai.
// ============================================================

import { getDb, normalizePhone } from "./_firebase.js";
import { getAuth } from "firebase-admin/auth";

const GRAPH = "https://graph.facebook.com/v21.0";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ---- Login check ----
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!idToken) {
      return res.status(401).json({ error: "Login required" });
    }

    const db = getDb();
    let decoded;
    try {
      decoded = await getAuth().verifyIdToken(idToken);
    } catch (e) {
      return res.status(401).json({ error: "Invalid session" });
    }

    // Sirf admins collection wale log bhej sakte hain
    const adminSnap = await db.collection("admins").doc(decoded.uid).get();
    if (!adminSnap.exists) {
      return res.status(403).json({ error: "Not authorized" });
    }
    const agentName = adminSnap.data()?.name || decoded.email || "Team";

    // ---- Message bhejna ----
    const { to, text } = req.body || {};
    if (!to || !text || !String(text).trim()) {
      return res.status(400).json({ error: "Number aur message dono chahiye" });
    }

    // Jis number pe student ne message kiya tha, usi se reply jayega.
    // (24-ghante ka window har number ka alag hota hai — galat number se
    //  bheja jaye to Meta reject kar deta hai, aur student ka inbox khali rehta hai.)
    const convoIdForLookup = normalizePhone(to) || to;
    let fromId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    try {
      const cSnap = await db.collection("conversations").doc(convoIdForLookup).get();
      if (cSnap.exists && cSnap.data().phoneNumberId) {
        fromId = cSnap.data().phoneNumberId;
      }
    } catch (e) {
      console.log("phoneNumberId nahi mila, default use ho raha hai:", e.message);
    }
    console.log("Reply is number se ja raha hai:", fromId);

    const r = await fetch(
      `${GRAPH}/${fromId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: String(text) },
        }),
      }
    );

    const data = await r.json();

    if (!r.ok) {
      const detail = data?.error?.message || "WhatsApp ne message reject kiya";
      return res.status(400).json({ error: detail });
    }

    // ---- Firestore mein save ----
    const convoId = normalizePhone(to) || to;
    const now = new Date();
    const convoRef = db.collection("conversations").doc(convoId);

    await convoRef.collection("messages").add({
      direction: "out",
      type: "text",
      text: String(text),
      waMessageId: data.messages?.[0]?.id || null,
      sentBy: agentName,
      status: "sent",
      timestamp: now,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    });

    await convoRef.set(
      {
        lastMessage: String(text).slice(0, 120),
        lastMessageAt: now,
        unread: 0,
        awaitingReply: false,
        assignedTo: agentName,
        assignedUid: decoded.uid,
        updatedAt: now,
      },
      { merge: true }
    );

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Send error:", err);
    return res.status(500).json({ error: "Message nahi ja saka" });
  }
}
