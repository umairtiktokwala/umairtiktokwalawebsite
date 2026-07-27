// ============================================================
//  MESSENGER SEND  —  PHASE 2
//  Dashboard yahan Messenger ka reply bhejta hai.
//
//  Zaroori Environment Variables:
//    MESSENGER_PAGE_TOKEN  = Page Access Token
//  (MESSENGER_PAGE_ID sirf webhook ke liye chahiye, yahan nahi)
// ============================================================

import { getDb } from "./_firebase.js";
import { getAuth } from "firebase-admin/auth";

const GRAPH = "https://graph.facebook.com/v21.0";
const PREFIX = "fb_";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ---- Login check (bilkul whatsapp-send jaisa) ----
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

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

    // ---- Input ----
    const body = req.body || {};
    // psid seedha bhi aa sakta hai, ya convoId (fb_123...) se nikal lein
    let psid = body.psid || body.to || "";
    if (!psid && body.convoId) psid = String(body.convoId).replace(/^fb_/, "");
    psid = String(psid).replace(/^fb_/, "").trim();

    const text = body.text;

    if (!psid || !text || !String(text).trim()) {
      return res.status(400).json({ error: "Recipient aur message dono chahiye" });
    }

    const pageToken = process.env.MESSENGER_PAGE_TOKEN;
    if (!pageToken) {
      return res.status(500).json({ error: "MESSENGER_PAGE_TOKEN set nahi hai" });
    }

    // ---- Meta ko bhejna ----
    const r = await fetch(
      `${GRAPH}/me/messages?access_token=${encodeURIComponent(pageToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_type: "RESPONSE",
          recipient: { id: psid },
          message: { text: String(text) },
        }),
      }
    );

    const data = await r.json();

    if (!r.ok) {
      console.error("Messenger send failed:", JSON.stringify(data));
      return res.status(400).json({ error: friendlyError(data) });
    }

    // ---- Firestore mein save ----
    // Note: echo webhook bhi yehi message wapas bhejega, magar
    // messenger-webhook.js mid dekh kar duplicate rok deta hai.
    const convoId = PREFIX + psid;
    const now = new Date();
    const convoRef = db.collection("conversations").doc(convoId);

    await convoRef.collection("messages").add({
      direction: "out",
      channel: "messenger",
      type: "text",
      text: String(text),
      waMessageId: data.message_id || null,
      mediaId: null,
      mediaUrlDirect: null,
      sentBy: agentName,
      status: "sent",
      timestamp: now,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    });

    await convoRef.set(
      {
        channel: "messenger",
        psid: psid,
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
    console.error("Messenger send error:", err);
    return res.status(500).json({ error: "Message nahi ja saka" });
  }
}

// Meta ki angrezi error ko aasan Roman Urdu mein badalna
function friendlyError(data) {
  const e = (data && data.error) || {};
  const code = e.code;
  const sub = e.error_subcode;
  const msg = e.message || "Messenger ne message reject kiya";

  if (sub === 2018278 || /outside of allowed window|24 hour/i.test(msg)) {
    return "24 ghante ka window band ho chuka hai. Student ke naye message ka intezar karein.";
  }
  if (sub === 2018001 || /No matching user/i.test(msg)) {
    return "Ye user ab page ko message nahi kar sakta (ya usne chat delete kar di).";
  }
  if (code === 10 || /permission/i.test(msg)) {
    return "Permission nahi hai. App abhi development mode mein hai — sirf testers ko reply ja sakta hai.";
  }
  if (code === 190 || /access token/i.test(msg)) {
    return "Page token khatam ya ghalat hai. Meta se naya token bana kar Vercel mein daalein.";
  }
  return msg;
}
