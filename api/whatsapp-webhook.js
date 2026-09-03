// ============================================================
//  WHATSAPP WEBHOOK
//  Meta yahan messages bhejta hai. Ye file:
//   1. Message ko Firestore mein save karti hai
//   2. Student ka record dhoondti hai (naam, batch, course)
//   3. Off-time / survey / auto-reply ka jawab bhejti hai
//
//  ABHI KI HALAT (_config.js dekhein):
//    Welcome ..... BAND      Keyword ..... BAND
//    Weekend ..... CHALU     Raat ........ CHALU     Lunch ..... CHALU
//  Yaani student ko sirf off-time ke message jate hain.
//
//  ---- TEEN BUNYADI BAATEIN (inhein na chhedein) ----
//
//  1. Reply usi number se jata hai jis par message aaya.
//     Pehle hamesha env wala number istemal hota tha, is liye +92 par
//     aane wale message ka jawab +1 se jata tha aur Meta usay reject kar
//     deta tha. 24-ghante ka window har number ka alag hota hai.
//
//  2. Meta ko jawab dene se PEHLE saara kaam mukammal hona chahiye.
//     Vercel response bhejte hi function band kar deta hai — bina await
//     kiye Firestore ka kaam adhoora reh jata hai.
//
//  3. Lunch ka cooldown alag hai, raat/weekend se juda.
//     Ek record use na karein, warna ek doosre ko rok denge.
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
  WORK_START_HOUR,
  WORK_END_HOUR,
  WEEKEND_START_DAY,
  WEEKEND_START_HOUR,
  WEEKEND_END_DAY,
  WEEKEND_END_HOUR,
  WEEKEND_MESSAGE,
  NIGHT_MESSAGE,
  OFFTIME_ENABLED,
  NIGHT_ENABLED,
  LUNCH_ENABLED,
  LUNCH_START_HOUR,
  LUNCH_START_MIN,
  LUNCH_END_HOUR,
  LUNCH_END_MIN,
  LUNCH_DAYS,
  LUNCH_MESSAGE,
  OFFTIME_COOLDOWN_MINUTES,
  LUNCH_COOLDOWN_MINUTES,
} from "./_config.js";

const GRAPH = "https://graph.facebook.com/v21.0";
const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// ============================================================
//  ENTRY POINT
// ============================================================
export default async function handler(req, res) {
  // ---- Meta ki verification (sirf webhook set karte waqt chalti hai) ----
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

  // Baat no. 2 — kaam pehle, jawab baad mein.
  try {
    await processWebhook(req.body);
  } catch (err) {
    console.error("WEBHOOK ERROR:", err?.message || err);
    console.error("STACK:", err?.stack || "no stack");
  }

  // Meta ko hamesha 200 dein. Warna wo dobara bhejta rehta hai aur
  // ek hi message kai baar save ho jata hai.
  return res.status(200).json({ received: true });
}

// ============================================================
//  MAIN
// ============================================================
async function processWebhook(body) {
  const change = body?.entry?.[0]?.changes?.[0]?.value;
  if (!change) {
    console.log("No change object in payload");
    return;
  }

  console.log(
    "Webhook received. messages:", change.messages?.length || 0,
    "statuses:", change.statuses?.length || 0
  );

  const db = getDb();

  // Delivery / read updates — ye poore function ko rok na saken,
  // is liye apne try/catch mein.
  await handleStatuses(db, change.statuses);

  const messages = change.messages;
  if (!Array.isArray(messages) || messages.length === 0) return;

  // Baat no. 1 — message KIS number par aaya, reply bhi isi se jayega.
  const inboxNumberId =
    change.metadata?.phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID;
  console.log("Message aaya is number pe:", inboxNumberId);

  const contactName = change.contacts?.[0]?.profile?.name || "";

  for (const msg of messages) {
    try {
      await handleMessage(db, msg, inboxNumberId, contactName);
    } catch (e) {
      console.error("Message skipped:", e?.message || e);
    }
  }
}

// ============================================================
//  DELIVERY / READ STATUS
// ============================================================
async function handleStatuses(db, statuses) {
  if (!Array.isArray(statuses)) return;
  try {
    for (const st of statuses) {
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

// ============================================================
//  EK MESSAGE
// ============================================================
async function handleMessage(db, msg, inboxNumberId, contactName) {
  const from = msg.from;
  if (!from) return;

  const convoId = normalizePhone(from) || from;
  const convoRef = db.collection("conversations").doc(convoId);
  const convoSnap = await convoRef.get();
  const isFirstEver = !convoSnap.exists;
  const prev = (convoSnap.exists && convoSnap.data()) || {};

  const parsed = parseMessage(msg);
  const now = new Date();

  // ---- Student ka record (ek dafa mil jaye to dobara nahi dhoondte) ----
  const student = prev.student || (await findStudent(from));

  // ---- Conversation update ----
  const convoData = {
    waNumber: from,
    phoneNumberId: inboxNumberId,
    displayName: contactName || prev.displayName || "",
    lastMessage: parsed.preview.slice(0, 120),
    lastMessageAt: now,
    windowExpiresAt: new Date(now.getTime() + DAY_MS),
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
    type: parsed.type,
    text: parsed.text,
    waMessageId: msg.id || null,
    mediaId: parsed.mediaId,
    mimeType: parsed.mimeType,
    filename: parsed.filename,
    timestamp: now,
    expiresAt: new Date(now.getTime() + RETENTION_DAYS * DAY_MS),
  });

  // ---- Survey chal raha ho to wahi handle karo, aage kuch nahi ----
  const surveyDone = await handleSurvey(
    convoRef, prev, parsed, from, inboxNumberId, now
  );
  if (surveyDone) return;

  // ---- Off time ka message ----
  await maybeSendOffTime(convoRef, prev, from, inboxNumberId, now);

  // ---- Welcome / keyword (dono abhi band hain) ----
  await maybeSendAutoReply(
    convoRef, prev, parsed, from, inboxNumberId, now, isFirstEver
  );
}

// ============================================================
//  SURVEY
//  true wapas kare to matlab survey ka jawab tha — aage kuch na karo.
// ============================================================
async function handleSurvey(convoRef, prev, parsed, from, numberId, now) {
  if (parsed.type !== "text") return false;
  const ans = (parsed.text || "").trim();

  // ---- Pehla sawal: masla hal hua? ----
  if (prev.surveyPending === true) {
    let answered = null;
    if (ans === "1" || /^haan|^yes|^han\b/i.test(ans)) answered = "yes";
    else if (ans === "2" || /^nahi|^no\b/i.test(ans)) answered = "no";

    if (answered) {
      await sendText(from,
        answered === "yes" ? SURVEY_REPLY_YES : SURVEY_REPLY_NO,
        convoRef, "survey", numberId);
      // Foran doosra sawal — team ka behaviour
      await sendText(from, SURVEY_MESSAGE_2, convoRef, "survey", numberId);

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
      return true;
    }
    // Koi aur jawab — survey band, normal chat
    await convoRef.set({ surveyPending: false }, { merge: true });
  }

  // ---- Doosra sawal: behaviour ----
  if (prev.survey2Pending === true) {
    let rating = null;
    if (ans === "1" || /bohot ach|bahut ach|excellent|great/i.test(ans)) rating = 3;
    else if (ans === "2" || /theek|ok\b|thik/i.test(ans)) rating = 2;
    else if (ans === "3" || /ach+a nahi|bura|bad|poor/i.test(ans)) rating = 1;

    if (rating) {
      await sendText(from, SURVEY_REPLY_DONE, convoRef, "survey", numberId);
      await convoRef.set({
        survey2Pending: false,
        behaviourRating: rating,   // 3 = bohot achha, 2 = theek, 1 = achha nahi
        behaviourAnsweredAt: now,
        behaviourAgent: prev.surveyAgent || prev.assignedTo || null,
        awaitingReply: false,
        unread: prev.unread || 0,
      }, { merge: true });
      return true;
    }
    await convoRef.set({ survey2Pending: false }, { merge: true });
  }

  return false;
}

// ============================================================
//  OFF TIME
// ============================================================
async function maybeSendOffTime(convoRef, prev, from, numberId, now) {
  if (!OFFTIME_ENABLED) return;

  const off = offTimeMessage();
  if (!off) return;   // working time hai

  // Baat no. 3 — lunch ka record aur cooldown alag.
  const isLunch = off.kind === "lunch";
  const lastAt = isLunch
    ? (prev.lastLunchMsg?.toMillis ? prev.lastLunchMsg.toMillis() : 0)
    : (prev.lastOffTimeMsg?.toMillis ? prev.lastOffTimeMsg.toMillis() : 0);
  const cooldownMins = isLunch ? LUNCH_COOLDOWN_MINUTES : OFFTIME_COOLDOWN_MINUTES;

  if (now.getTime() - lastAt <= cooldownMins * 60 * 1000) return;

  await sendText(from, off.msg, convoRef, "offtime", numberId);
  await convoRef.set(
    isLunch ? { lastLunchMsg: now } : { lastOffTimeMsg: now },
    { merge: true }
  );
}

// ============================================================
//  WELCOME / KEYWORD
//  Dono _config.js se band hain. Chalu karne se pehle wahan ka matn
//  parh lein — tareekhein purani ho jati hain.
// ============================================================
async function maybeSendAutoReply(convoRef, prev, parsed, from, numberId, now, isFirstEver) {
  if (isFirstEver && WELCOME_ENABLED) {
    await sendText(from, WELCOME_MESSAGE, convoRef, "welcome", numberId);
    return;
  }

  if (!KEYWORDS_ENABLED || parsed.type !== "text") return;

  const match = findKeywordMatch(parsed.text);
  if (!match) return;

  const lastSent = prev.lastAutoReply ? prev.lastAutoReply[match.index] : null;
  const lastMs = lastSent?.toMillis ? lastSent.toMillis() : 0;
  if (now.getTime() - lastMs <= KEYWORD_COOLDOWN_MINUTES * 60 * 1000) return;

  await sendText(from, match.reply, convoRef, "keyword", numberId);
  await convoRef.set({ lastAutoReply: { [match.index]: now } }, { merge: true });
}

// ============================================================
//  MESSAGE KA MATN / MEDIA
// ============================================================
function parseMessage(msg) {
  const out = {
    type: msg.type || "text",
    text: "",
    mediaId: null,
    mimeType: null,
    filename: null,
    preview: "",
  };

  if (out.type === "text") {
    out.text = msg.text?.body || "";
  } else if (out.type === "button") {
    out.text = msg.button?.text || "";
  } else if (out.type === "interactive") {
    out.text =
      msg.interactive?.button_reply?.title ||
      msg.interactive?.list_reply?.title || "";
  }

  const media = msg.image || msg.video || msg.audio || msg.voice ||
                msg.document || msg.sticker || null;

  if (media) {
    out.mediaId = media.id || null;
    out.mimeType = media.mime_type || null;
    out.filename = media.filename || null;
    out.text = media.caption || "";      // caption ho to wohi text hai
    if (msg.voice) out.type = "audio";
  }

  // List mein dikhane ke liye chhota sa label
  if (out.text) {
    if (media) {
      const tag = out.type === "image" ? "📷"
                : out.type === "video" ? "🎥" : "📄";
      out.preview = tag + " " + out.text;
    } else {
      out.preview = out.text;
    }
  } else {
    const labels = {
      image: "📷 Image",
      video: "🎥 Video",
      audio: "🎤 Voice note",
      sticker: "Sticker",
      location: "📍 Location",
      contacts: "👤 Contact",
    };
    out.preview = out.type === "document"
      ? "📄 " + (out.filename || "Document")
      : (labels[out.type] || "[" + out.type + "]");
  }

  return out;
}

// ============================================================
//  WAQT
// ============================================================

// Pakistan ka waqt — server duniya mein kahin bhi ho
function pakNow() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Karachi" })
  );
}

// Abhi off time hai ya nahi.
// Off ho to { msg, kind } wapas, warna null.
//   kind = "weekend" | "night" | "lunch"  (isi se cooldown tay hota hai)
//
// Tarteeb ahem hai: weekend ko pehla darja hai. Jumeraat 4 baje ke baad
// raat ya lunch ka message nahi jana chahiye — weekend hi jayega.
function offTimeMessage() {
  const now = pakNow();
  const day = now.getDay();     // 0 = Itwar ... 6 = Hafta
  const hour = now.getHours();
  const mins = hour * 60 + now.getMinutes();

  // ---- 1. Weekend: Jumeraat 4pm se Hafta 8am tak ----
  const afterStart =
    day > WEEKEND_START_DAY ||
    (day === WEEKEND_START_DAY && hour >= WEEKEND_START_HOUR);
  const beforeEnd =
    day < WEEKEND_END_DAY ||
    (day === WEEKEND_END_DAY && hour < WEEKEND_END_HOUR);

  if (afterStart && beforeEnd) return { msg: WEEKEND_MESSAGE, kind: "weekend" };

  // ---- 2. Raat: subha 8 se raat 11 ke bahar ----
  if (NIGHT_ENABLED && (hour < WORK_START_HOUR || hour >= WORK_END_HOUR)) {
    return { msg: NIGHT_MESSAGE, kind: "night" };
  }

  // ---- 3. Lunch aur namaz ka break ----
  // Minute tak ka hisab, kyunke waqt 1:30 se 2:30 hai.
  if (LUNCH_ENABLED && Array.isArray(LUNCH_DAYS) && LUNCH_DAYS.includes(day)) {
    const from = LUNCH_START_HOUR * 60 + LUNCH_START_MIN;
    const to   = LUNCH_END_HOUR   * 60 + LUNCH_END_MIN;
    if (mins >= from && mins < to) return { msg: LUNCH_MESSAGE, kind: "lunch" };
  }

  return null;   // working time hai
}

// ============================================================
//  KEYWORD MATCH
//  Upar wali entry pehle check hoti hai.
// ============================================================
function findKeywordMatch(text) {
  const lower = (text || "").toLowerCase();
  for (let i = 0; i < AUTO_REPLIES.length; i++) {
    for (const kw of AUTO_REPLIES[i].keywords) {
      if (lower.includes(kw.toLowerCase())) {
        return { index: String(i), reply: AUTO_REPLIES[i].reply };
      }
    }
  }
  return null;
}

// ============================================================
//  MESSAGE BHEJNA
//  Baat no. 1 — jis number par message aaya, usi se jawab jayega.
// ============================================================
async function sendText(to, body, convoRef, sentBy, phoneNumberId) {
  const fromId = phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;

  const r = await fetch(`${GRAPH}/${fromId}/messages`, {
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
    expiresAt: new Date(now.getTime() + RETENTION_DAYS * DAY_MS),
  });

  return data;
}
