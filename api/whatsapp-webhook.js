// ============================================================
//  WHATSAPP WEBHOOK
//  Meta yahan messages bhejta hai. Ye file:
//   1. Message ko Firestore mein save karti hai
//   2. Student ka record dhoondti hai (naam, batch, course)
//   3. Welcome / keyword auto-reply bhejti hai
// ============================================================

import { getDb, findStudent, normalizePhone } from "./_firebase.js";
import {
  WELCOME_MESSAGE,
  WELCOME_ENABLED,
  KEYWORDS_ENABLED,
  KEYWORD_COOLDOWN_MINUTES,
  AUTO_REPLIES,
  SURVEY_REPLY_YES,
  SURVEY_REPLY_NO,
  SURVEY_MESSAGE_2,
  SURVEY_REPLY_DONE,
} from "./_config.js";

const GRAPH = "https://graph.facebook.com/v21.0";

export default async function handler(req, res) {
  // ---- Meta ki verification (sirf ek baar chalti hai) ----
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Kaam pehle mukammal karein, phir Meta ko jawab dein.
  // (Vercel response bhejte hi function band kar deta hai, is liye
  //  await karna zaroori hai — warna Firestore ka kaam adhoora reh jata hai.)
  try {
    await processWebhook(req.body);
  } catch (err) {
    console.error("WEBHOOK ERROR:", err && err.message ? err.message : err);
    console.error("STACK:", err && err.stack ? err.stack : "no stack");
  }

  return res.status(200).json({ received: true });
}

async function processWebhook(body) {
  const entry = body?.entry?.[0];
  const change = entry?.changes?.[0]?.value;
  if (!change) {
    console.log("No change object in payload");
    return;
  }
  console.log("Webhook received. messages:", change.messages ? change.messages.length : 0,
              "statuses:", change.statuses ? change.statuses.length : 0);

  const db = getDb();

  // ---- Delivery / read status updates ----
  // Ye poore function ko rok na sake, is liye alag try/catch mein hai.
  if (Array.isArray(change.statuses)) {
    try {
      for (const st of change.statuses) {
        if (!st.id || !st.recipient_id) continue;
        const cid = normalizePhone(st.recipient_id) || st.recipient_id;
        const q = await db
          .collection("conversations")
          .doc(cid)
          .collection("messages")
          .where("waMessageId", "==", st.id)
          .limit(1)
          .get();
        if (!q.empty) {
          await q.docs[0].ref.update({ status: st.status || "sent" });
        }
      }
    } catch (e) {
      console.log("Status update skipped:", e.message);
    }
  }

  const messages = change.messages;
  if (!Array.isArray(messages) || messages.length === 0) return;

  const contactName = change.contacts?.[0]?.profile?.name || "";

  for (const msg of messages) {
    const from = msg.from;
    if (!from) continue;

    const convoId = normalizePhone(from) || from;
    const convoRef = db.collection("conversations").doc(convoId);
    const convoSnap = await convoRef.get();
    const isFirstEver = !convoSnap.exists;
    const prev = (convoSnap.exists && convoSnap.data()) || {};

    // ---- Message ka text nikalna ----
    let text = "";
    let type = msg.type || "text";

    if (type === "text") {
      text = msg.text?.body || "";
    } else if (type === "button") {
      text = msg.button?.text || "";
    } else if (type === "interactive") {
      text =
        msg.interactive?.button_reply?.title ||
        msg.interactive?.list_reply?.title ||
        "";
    }

    // ---- Media (image / video / audio / document / sticker) ----
    let mediaId = null, mimeType = null, filename = null;
    const mediaObj = msg.image || msg.video || msg.audio || msg.voice ||
                     msg.document || msg.sticker || null;

    if (mediaObj) {
      mediaId = mediaObj.id || null;
      mimeType = mediaObj.mime_type || null;
      filename = mediaObj.filename || null;
      // caption ho to wohi text hai
      text = mediaObj.caption || "";
      if (msg.voice) type = "audio";
    }

    // List mein dikhane ke liye chhota sa label
    let preview = text;
    if (!preview) {
      if (type === "image") preview = "📷 Image";
      else if (type === "video") preview = "🎥 Video";
      else if (type === "audio") preview = "🎤 Voice note";
      else if (type === "document") preview = "📄 " + (filename || "Document");
      else if (type === "sticker") preview = "Sticker";
      else if (type === "location") preview = "📍 Location";
      else if (type === "contacts") preview = "👤 Contact";
      else preview = "[" + type + "]";
    } else if (mediaObj) {
      const tag = type === "image" ? "📷" : type === "video" ? "🎥" : "📄";
      preview = tag + " " + text;
    }

    // ---- Student ka record ----
    let student = prev.student || null;
    if (!student) {
      student = await findStudent(from);
    }

    // ---- Conversation update ----
    const now = new Date();
    const convoData = {
      waNumber: from,
      displayName: contactName || prev.displayName || "",
      lastMessage: preview.slice(0, 120),
      lastMessageAt: now,
      windowExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      unread: (prev.unread || 0) + 1,
      status: "open",
      awaitingReply: true,
      updatedAt: now,
    };
    if (student) convoData.student = student;
    if (isFirstEver) convoData.createdAt = now;

    await convoRef.set(convoData, { merge: true });
    console.log("Saved conversation:", convoId, "first:", isFirstEver);

    // ---- Message save ----
    await convoRef.collection("messages").add({
      direction: "in",
      type,
      text,
      waMessageId: msg.id || null,
      mediaId,
      mimeType,
      filename,
      timestamp: now,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    });

    // ---- Survey: pehla sawal (masla hal hua?) ----
    if (prev.surveyPending === true && type === "text") {
      const ans = text.trim();
      let answered = null;
      if (ans === "1" || /^haan|^yes|^han\b/i.test(ans)) answered = "yes";
      else if (ans === "2" || /^nahi|^no\b/i.test(ans)) answered = "no";

      if (answered) {
        await sendText(from, answered === "yes" ? SURVEY_REPLY_YES : SURVEY_REPLY_NO,
                       convoRef, "survey");
        // Foran doosra sawal — team ka behaviour
        await sendText(from, SURVEY_MESSAGE_2, convoRef, "survey");

        await convoRef.set({
          surveyPending: false,
          survey2Pending: true,
          surveyAnswer: answered,
          surveyAnsweredAt: now,
          surveyAgent: prev.assignedTo || null,
          status: answered === "yes" ? "resolved" : "open",
          awaitingReply: answered === "no",
          unread: prev.unread || 0,
        }, { merge: true });
        continue;
      }
      // Koi aur jawab — survey band, normal chat
      await convoRef.set({ surveyPending: false }, { merge: true });
    }

    // ---- Survey: doosra sawal (behaviour) ----
    if (prev.survey2Pending === true && type === "text") {
      const ans = text.trim();
      let rating = null;
      if (ans === "1" || /bohot ach|bahut ach|excellent|great/i.test(ans)) rating = 3;
      else if (ans === "2" || /theek|ok\b|thik/i.test(ans)) rating = 2;
      else if (ans === "3" || /ach+a nahi|bura|bad|poor/i.test(ans)) rating = 1;

      if (rating) {
        await sendText(from, SURVEY_REPLY_DONE, convoRef, "survey");
        await convoRef.set({
          survey2Pending: false,
          behaviourRating: rating,      // 3 = bohot achha, 2 = theek, 1 = achha nahi
          behaviourAnsweredAt: now,
          behaviourAgent: prev.surveyAgent || prev.assignedTo || null,
          awaitingReply: false,
          unread: prev.unread || 0,
        }, { merge: true });
        continue;
      }
      await convoRef.set({ survey2Pending: false }, { merge: true });
    }

    // ---- Auto-reply ----
    let replied = false;

    if (isFirstEver && WELCOME_ENABLED) {
      await sendText(from, WELCOME_MESSAGE, convoRef, "welcome");
      replied = true;
    }

    if (!replied && KEYWORDS_ENABLED && type === "text") {
      const match = findKeywordMatch(text);
      if (match) {
        const lastSent = prev.lastAutoReply ? prev.lastAutoReply[match.index] : null;
        const cooldownMs = KEYWORD_COOLDOWN_MINUTES * 60 * 1000;
        const lastMs = lastSent?.toMillis ? lastSent.toMillis() : 0;

        if (now.getTime() - lastMs > cooldownMs) {
          await sendText(from, match.reply, convoRef, "keyword");
          await convoRef.set(
            { lastAutoReply: { [match.index]: now } },
            { merge: true }
          );
        }
      }
    }
  }
}

function findKeywordMatch(text) {
  const lower = (text || "").toLowerCase();
  for (let i = 0; i < AUTO_REPLIES.length; i++) {
    const entry = AUTO_REPLIES[i];
    for (const kw of entry.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        return { index: String(i), reply: entry.reply };
      }
    }
  }
  return null;
}

async function sendText(to, body, convoRef, sentBy) {
  const url = `${GRAPH}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });

  const data = await r.json();
  if (!r.ok) {
    console.error("Send failed:", JSON.stringify(data));
    return null;
  }

  const now = new Date();
  await convoRef.collection("messages").add({
    direction: "out",
    type: "text",
    text: body,
    waMessageId: data.messages?.[0]?.id || null,
    sentBy: sentBy || "system",
    status: "sent",
    timestamp: now,
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
  });

  return data;
}
