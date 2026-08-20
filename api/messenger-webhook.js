// ============================================================
//  FACEBOOK MESSENGER WEBHOOK  —  PHASE 1 (sirf receive)
//
//  Meta yahan Facebook Page ke messages bhejta hai. Ye file:
//   1. Message ko Firestore mein save karti hai (wohi conversations collection)
//   2. Bhejne wale ka naam Graph API se le kar rakhti hai
//   3. Page se bheje gaye messages (echo) bhi save karti hai
//
//  PHASE 1 mein ye file KUCH BHEJTI NAHI — na welcome, na keyword reply.
//  Reply bhejna Phase 2 mein aayega (api/messenger-send.js).
//
//  Zaroori Environment Variables (Vercel mein):
//    MESSENGER_PAGE_TOKEN    = Page Access Token
//    MESSENGER_PAGE_ID       = Facebook Page ID
//    MESSENGER_VERIFY_TOKEN  = utw2026   (na ho to WHATSAPP_VERIFY_TOKEN chalega)
// ============================================================

import { getDb } from "./_firebase.js";

const GRAPH = "https://graph.facebook.com/v21.0";
const RETENTION_DAYS = 30;

// Messenger ki conversation ID ese banti hai: fb_<PSID>
// (WhatsApp wali ID sirf 10 digit ki hoti hai, is liye kabhi takraav nahi hoga)
const PREFIX = "fb_";

export default async function handler(req, res) {
  // ---- Meta ki verification (sirf webhook set karte waqt chalti hai) ----
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    const expected =
      process.env.MESSENGER_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN;

    if (mode === "subscribe" && expected && token === expected) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Kaam pehle mukammal karein, phir Meta ko jawab dein.
  try {
    await processWebhook(req.body);
  } catch (err) {
    console.error("MESSENGER WEBHOOK ERROR:", err && err.message ? err.message : err);
    console.error("STACK:", err && err.stack ? err.stack : "no stack");
  }

  return res.status(200).json({ received: true });
}

async function processWebhook(body) {
  if (!body || body.object !== "page") {
    console.log("Messenger: not a page event, ignored");
    return;
  }

  const entries = Array.isArray(body.entry) ? body.entry : [];
  const db = getDb();
  const myPageId = process.env.MESSENGER_PAGE_ID || "";

  for (const entry of entries) {
    // Sirf apni page ke events lein
    if (myPageId && String(entry.id) !== String(myPageId)) {
      console.log("Messenger: doosri page ka event, chhoR diya:", entry.id);
      continue;
    }

    // ---- Comments (feed webhook) ----
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const ch of changes) {
      if (ch.field !== "feed") continue;
      try {
        await handleFeed(db, ch.value, entry.id);
      } catch (e) {
        console.error("Feed event skipped:", e.message);
      }
    }

    const events = Array.isArray(entry.messaging) ? entry.messaging : [];
    console.log("Messenger webhook: events =", events.length, "| feed changes =", changes.length);

    for (const ev of events) {
      try {
        if (ev.message && ev.message.is_echo) {
          await handleEcho(db, ev);
        } else if (ev.message) {
          await handleIncoming(db, ev);
        } else if (ev.postback) {
          await handlePostback(db, ev);
        }
        // delivery / read events abhi nazar-andaz — Phase 2 mein
      } catch (e) {
        console.error("Messenger event skipped:", e.message);
      }
    }
  }
}

// ============================================================
//  Student ka message aaya
// ============================================================
async function handleIncoming(db, ev) {
  const psid = ev.sender && ev.sender.id;
  if (!psid) return;

  const pageId = (ev.recipient && ev.recipient.id) || process.env.MESSENGER_PAGE_ID || "";
  const convoId = PREFIX + psid;
  const convoRef = db.collection("conversations").doc(convoId);
  const convoSnap = await convoRef.get();
  const isFirstEver = !convoSnap.exists;
  const prev = (convoSnap.exists && convoSnap.data()) || {};

  const parsed = parseMessage(ev.message);
  const now = new Date();

  // ---- Bhejne wale ka naam (sirf pehli baar) ----
  let displayName = prev.displayName || "";
  if (!displayName) {
    displayName = await fetchProfileName(psid);
  }

  // ---- Conversation update ----
  const convoData = {
    channel: "messenger",           // <-- isi se dashboard pehchanta hai
    psid: psid,
    pageId: pageId,
    displayName: displayName || prev.displayName || "",
    lastMessage: parsed.preview.slice(0, 120),
    lastMessageAt: now,
    windowExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    unread: (prev.unread || 0) + 1,
    status: "open",
    awaitingReply: true,
    updatedAt: now,
  };
  if (isFirstEver) convoData.createdAt = now;

  await convoRef.set(convoData, { merge: true });
  console.log("Messenger saved convo:", convoId, "first:", isFirstEver);

  // ---- Message save ----
  await convoRef.collection("messages").add({
    direction: "in",
    channel: "messenger",
    type: parsed.type,
    text: parsed.text,
    waMessageId: (ev.message && ev.message.mid) || null,
    mediaUrlDirect: parsed.mediaUrlDirect,   // Messenger ka apna CDN link
    mediaId: null,                            // Messenger mein media ID nahi hoti
    mimeType: null,
    filename: parsed.filename,
    timestamp: now,
    expiresAt: new Date(now.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
  });
}

// ============================================================
//  Page ki taraf se gaya message (echo)
//  Ye tab aata hai jab koi Meta Business Suite / Page inbox se reply kare,
//  ya jab hum khud API se bhejen (Phase 2).
// ============================================================
async function handleEcho(db, ev) {
  const psid = ev.recipient && ev.recipient.id;   // echo mein recipient = student
  if (!psid) return;

  const convoId = PREFIX + psid;
  const convoRef = db.collection("conversations").doc(convoId);
  const convoSnap = await convoRef.get();
  if (!convoSnap.exists) return;   // pehle student ka message aana chahiye

  const prev = convoSnap.data() || {};
  const mid = (ev.message && ev.message.mid) || null;

  // Ek hi message do baar save na ho (API se bheja hua message bhi echo ban kar wapas aata hai)
  if (mid) {
    const dup = await convoRef
      .collection("messages")
      .where("waMessageId", "==", mid)
      .limit(1)
      .get();
    if (!dup.empty) {
      console.log("Messenger echo pehle se maujood, chhoR diya:", mid);
      return;
    }
  }

  const parsed = parseMessage(ev.message);
  const now = new Date();

  await convoRef.collection("messages").add({
    direction: "out",
    channel: "messenger",
    type: parsed.type,
    text: parsed.text,
    waMessageId: mid,
    mediaUrlDirect: parsed.mediaUrlDirect,
    mediaId: null,
    mimeType: null,
    filename: parsed.filename,
    sentBy: "page-inbox",           // Meta Business Suite se gaya
    status: "sent",
    timestamp: now,
    expiresAt: new Date(now.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
  });

  await convoRef.set({
    lastMessage: parsed.preview.slice(0, 120),
    lastMessageAt: now,
    awaitingReply: false,
    unread: prev.unread || 0,
    updatedAt: now,
  }, { merge: true });
}

// ============================================================
//  Button dabaya (Get Started wagera)
// ============================================================
async function handlePostback(db, ev) {
  const psid = ev.sender && ev.sender.id;
  if (!psid) return;

  const title = (ev.postback && (ev.postback.title || ev.postback.payload)) || "Button";
  await handleIncoming(db, {
    sender: ev.sender,
    recipient: ev.recipient,
    message: { mid: (ev.postback && ev.postback.mid) || null, text: title },
  });
}

// ============================================================
//  Message ka matn / media nikalna
// ============================================================
function parseMessage(message) {
  const out = {
    type: "text",
    text: (message && message.text) || "",
    mediaUrlDirect: null,
    filename: null,
    preview: "",
  };

  const att = message && Array.isArray(message.attachments) ? message.attachments[0] : null;

  if (att) {
    const payload = att.payload || {};
    out.mediaUrlDirect = payload.url || null;

    if (att.type === "image") {
      out.type = payload.sticker_id ? "sticker" : "image";
    } else if (att.type === "video") {
      out.type = "video";
    } else if (att.type === "audio") {
      out.type = "audio";
    } else if (att.type === "file") {
      out.type = "document";
      out.filename = payload.name || "File";
    } else if (att.type === "location") {
      out.type = "location";
    } else {
      out.type = "attachment";       // fallback / share / template
    }
  }

  // List mein dikhane ke liye chhota sa label
  let preview = out.text;
  if (!preview) {
    if (out.type === "image") preview = "\uD83D\uDCF7 Image";
    else if (out.type === "sticker") preview = "Sticker";
    else if (out.type === "video") preview = "\uD83C\uDFA5 Video";
    else if (out.type === "audio") preview = "\uD83C\uDFA4 Voice note";
    else if (out.type === "document") preview = "\uD83D\uDCC4 " + (out.filename || "Document");
    else if (out.type === "location") preview = "\uD83D\uDCCD Location";
    else if (out.type === "attachment") preview = "Attachment";
    else preview = "[" + out.type + "]";
  } else if (att) {
    const tag = out.type === "image" ? "\uD83D\uDCF7"
              : out.type === "video" ? "\uD83C\uDFA5" : "\uD83D\uDCC4";
    preview = tag + " " + out.text;
  }
  out.preview = preview;

  return out;
}

// ============================================================
//  Naam nikalna — Graph API se
//  (App development mode mein sirf testers ka naam milta hai,
//   baqi ke liye khali aayega — koi masla nahi)
// ============================================================
async function fetchProfileName(psid) {
  const token = process.env.MESSENGER_PAGE_TOKEN;
  if (!token) {
    console.log("MESSENGER_PAGE_TOKEN nahi mila — naam skip");
    return "";
  }
  try {
    const url = `${GRAPH}/${psid}?fields=first_name,last_name&access_token=${encodeURIComponent(token)}`;
    const r = await fetch(url);
    const data = await r.json();
    if (!r.ok) {
      console.log("Profile nahi mila:", JSON.stringify(data));
      return "";
    }
    return [data.first_name || "", data.last_name || ""].join(" ").trim();
  } catch (e) {
    console.log("Profile fetch error:", e.message);
    return "";
  }
}

// ============================================================
//  COMMENTS  —  page ke post pe kisi ne comment kiya
//  Webhook field: feed
// ============================================================
async function handleFeed(db, v, pageId) {
  if (!v) return;

  // Sirf comments — likes, posts, shares wagera chhoR dein
  if (v.item !== "comment") {
    console.log("Feed: item =", v.item, "— chhoR diya");
    return;
  }

  const commentId = v.comment_id;
  if (!commentId) return;

  const verb = v.verb || "add";              // add / edited / remove / hide / unhide
  const fromId = (v.from && v.from.id) || "";
  const myPage = String(pageId || process.env.MESSENGER_PAGE_ID || "");

  // Apni hi page ka comment (team ka reply) — list mein nahi dikhana
  if (fromId && myPage && String(fromId) === myPage) {
    console.log("Feed: apna hi comment, chhoR diya");
    return;
  }

  const ref = db.collection("comments").doc(String(commentId));

  // ---- Comment delete ho gaya ----
  if (verb === "remove") {
    await ref.set({
      status: "deleted",
      deletedAt: new Date(),
      unread: 0,
      updatedAt: new Date(),
    }, { merge: true });
    console.log("Comment deleted:", commentId);
    return;
  }

  // ---- Chhupaya / dobara dikhaya gaya ----
  if (verb === "hide" || verb === "unhide") {
    await ref.set({
      hidden: verb === "hide",
      updatedAt: new Date(),
    }, { merge: true });
    return;
  }

  const now = new Date();
  const createdMs = v.created_time ? v.created_time * 1000 : now.getTime();
  const snap = await ref.get();
  const isNew = !snap.exists;
  const prev = (snap.exists && snap.data()) || {};

  const data = {
    commentId: String(commentId),
    postId: v.post_id || "",
    parentId: v.parent_id && v.parent_id !== v.post_id ? v.parent_id : null,
    isReply: !!(v.parent_id && v.parent_id !== v.post_id),
    fromId: fromId || null,
    fromName: (v.from && v.from.name) || prev.fromName || "",
    message: v.message || "",
    permalink: v.permalink_url || prev.permalink || null,
    postText: (v.post && (v.post.status_type || "")) || prev.postText || "",
    createdAt: new Date(createdMs),
    updatedAt: now,
    pageId: myPage,
    hidden: false,
    expiresAt: new Date(now.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
  };

  if (isNew) {
    data.status = "open";
    data.unread = 1;
    data.repliedBy = null;
    data.replyText = null;
    data.privateReplySent = false;
  } else if (verb === "edited") {
    data.edited = true;
  }

  await ref.set(data, { merge: true });
  console.log("Comment saved:", commentId, "new:", isNew, "verb:", verb);
}
