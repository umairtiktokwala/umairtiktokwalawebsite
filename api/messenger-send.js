// ============================================================
//  MESSENGER SEND
//  Dashboard yahan Messenger ka reply bhejta hai.
//
//  ---- IS DAFA KYA THEEK HUA ----
//
//  Pehle do cheezein galat thin:
//
//    const pageToken = process.env.MESSENGER_PAGE_TOKEN;   // hamesha purana page
//    fetch(`${GRAPH}/me/messages?...`)                      // "me" = us token ka page
//
//  Yaani code HAR jawab purane page se bhejta tha. Naye page ke bande
//  ka PSID us page par maujood hi nahi hota, is liye Meta kehta tha
//  "No matching user found" — aur team ko ghalat paigham milta tha:
//  "Ye user ab page ko message nahi kar sakta."
//
//  Ab conversation ke pageId se pata karte hain ke chat KIS page ki
//  hai, aur usi page ke token se, usi page ke naam se bhejte hain.
//
//  ---- VERCEL MEIN YE VARIABLES ----
//    MESSENGER_PAGE_ID       aur  MESSENGER_PAGE_TOKEN
//    MESSENGER_PAGE_ID_2     aur  MESSENGER_PAGE_TOKEN_2
//    (aage _3, _4 bhi chal jayenge)
// ============================================================

import { getDb } from "./_firebase.js";
import { getAuth } from "firebase-admin/auth";

const GRAPH = "https://graph.facebook.com/v21.0";
const PREFIX = "fb_";

/* Har page ka token — wahi tareeqa jo messenger-webhook.js mein hai */
function loadPages() {
  const out = {};
  const add = (id, token) => {
    if (!id || !token) return;
    out[String(id).trim()] = String(token).trim();
  };
  add(process.env.MESSENGER_PAGE_ID, process.env.MESSENGER_PAGE_TOKEN);
  for (let i = 2; i <= 6; i++) {
    add(process.env["MESSENGER_PAGE_ID_" + i], process.env["MESSENGER_PAGE_TOKEN_" + i]);
  }
  return out;
}

const PAGES = loadPages();

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

    /* Ye chat kis page ki hai — conversation se pata karte hain.
       messenger-webhook.js har chat par pageId likh deta hai. */
    const convoRef0 = db.collection("conversations").doc(PREFIX + psid);
    const convoSnap0 = await convoRef0.get();
    const convoData0 = (convoSnap0.exists && convoSnap0.data()) || {};

    /* pageId na mile to pehla page — purani chats usi ki hain */
    const pageId = String(convoData0.pageId || process.env.MESSENGER_PAGE_ID || "").trim();
    const pageToken = PAGES[pageId] || process.env.MESSENGER_PAGE_TOKEN || "";

    if (!pageToken) {
      return res.status(500).json({
        error: "Is page ka token nahi mila. Vercel mein MESSENGER_PAGE_TOKEN check karein."
      });
    }

    /* "me" ki jagah page ka asal ID — us se saaf rehta hai ke message
       kis page se ja raha hai, aur galat token par error bhi saaf aata hai. */
    const from = pageId || "me";

    // ---- Meta ko bhejna ----
    const r = await fetch(
      `${GRAPH}/${from}/messages?access_token=${encodeURIComponent(pageToken)}`,
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
    const now = new Date();
    const convoRef = convoRef0;

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
        pageId: pageId || convoData0.pageId || null,
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
    /* Ye do wajah se aata hai:
       1. Bande ne waqai chat delete kar di
       2. Ya galat page ke token se bheja ja raha hai — har page ka
          apna PSID hota hai, doosre page par wo maujood nahi hota
       Doosri wajah pehle bahut waqt zaya kar chuki hai, is liye
       dono likh dete hain. */
    return "Meta ne kaha ye user nahi mila. Ya to us ne chat delete kar di, "
         + "ya is chat ka page aur token aapas mein nahi mil rahe.";
  }
  if (code === 10 || /permission/i.test(msg)) {
    return "Permission nahi hai. App abhi development mode mein hai — sirf testers ko reply ja sakta hai.";
  }
  if (code === 190 || /access token/i.test(msg)) {
    return "Page token khatam ya ghalat hai. Meta se naya token bana kar Vercel mein daalein.";
  }
  return msg;
}
