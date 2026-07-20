// ============================================================
//  SEND SURVEY
//  Dashboard ka "Send survey" button yahan call karta hai.
//  Student ko poochta hai ke masla hal hua ya nahi.
// ============================================================

import { getDb, normalizePhone } from "./_firebase.js";
import { getAuth } from "firebase-admin/auth";
import { SURVEY_MESSAGE } from "./_config.js";

const GRAPH = "https://graph.facebook.com/v21.0";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ---- Login check ----
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: "Login required" });

    const db = getDb();
    let decoded;
    try {
      decoded = await getAuth().verifyIdToken(idToken);
    } catch (e) {
      return res.status(401).json({ error: "Invalid session" });
    }

    const adminSnap = await db.collection("admins").doc(decoded.uid).get();
    if (!adminSnap.exists) return res.status(403).json({ error: "Not authorized" });
    const agentName = adminSnap.data()?.name || decoded.email || "Team";

    const { to } = req.body || {};
    if (!to) return res.status(400).json({ error: "Number chahiye" });

    // ---- Survey bhejein ----
    const r = await fetch(
      `${GRAPH}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
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
          text: { body: SURVEY_MESSAGE },
        }),
      }
    );

    const data = await r.json();
    if (!r.ok) {
      return res.status(400).json({
        error: data?.error?.message || "Survey nahi ja saka",
      });
    }

    // ---- Firestore mein save ----
    const convoId = normalizePhone(to) || to;
    const now = new Date();
    const convoRef = db.collection("conversations").doc(convoId);

    await convoRef.collection("messages").add({
      direction: "out",
      type: "text",
      text: SURVEY_MESSAGE,
      waMessageId: data.messages?.[0]?.id || null,
      sentBy: "survey",
      status: "sent",
      timestamp: now,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    });

    await convoRef.set(
      {
        surveyPending: true,
        surveySentAt: now,
        surveySentBy: agentName,
        surveyAnswer: null,
        lastMessage: "Survey bheja gaya",
        lastMessageAt: now,
        awaitingReply: false,
        updatedAt: now,
      },
      { merge: true }
    );

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Survey error:", err);
    return res.status(500).json({ error: "Survey nahi ja saka" });
  }
}
