// ============================================================
//  FACEBOOK MESSENGER WEBHOOK
//
//  Meta yahan Facebook Pages ke messages aur comments bhejta hai.
//
//  ---- IS DAFA KYA BADLA ----
//
//  1. AB DO (YA ZYADA) PAGES CHALTE HAIN
//     Pehle sirf MESSENGER_PAGE_ID wale page ke events liye jate the,
//     baqi sab pheink diye jate the. Ab har us page ka kaam hota hai
//     jis ka token neeche PAGES mein maujood ho.
//
//  2. HAR PAGE KA APNA TOKEN
//     Har Facebook page ka apna alag token hota hai. Naam nikalna ya
//     post ki tafseel lana — sab usi page ke token se hota hai.
//
//  3. COMMENT KE SAATH POST BHI
//     Pehle sirf status_type mehfooz hota tha (jaise "added_photos"),
//     jo team ke liye be-faida tha. Ab post ka asal matn, tasveer,
//     tareekh aur link bhi aata hai — taake team ko pata ho ke
//     comment KIS post par aaya hai.
//
//  ---- VERCEL MEIN YE VARIABLES ----
//    MESSENGER_PAGE_ID       = pehle page ka ID
//    MESSENGER_PAGE_TOKEN    = pehle page ka token
//    MESSENGER_PAGE_NAME     = pehle page ka chhota naam (marzi)
//
//    MESSENGER_PAGE_ID_2     = doosre page ka ID
//    MESSENGER_PAGE_TOKEN_2  = doosre page ka token
//    MESSENGER_PAGE_NAME_2   = doosre page ka chhota naam (marzi)
//
//    MESSENGER_VERIFY_TOKEN  = utw2026
//
//  Teesra page aage jorna ho to _3 laga kar wahi teen variable
//  daal dein — code khud utha lega.
// ============================================================

import { getDb } from "./_firebase.js";

const GRAPH = "https://graph.facebook.com/v21.0";
const RETENTION_DAYS = 30;
const PREFIX = "fb_";

/* ============================================================
   PAGES KI FEHRIST
   Environment se banti hai. Pehla bina number ke, baqi _2, _3…
   ============================================================ */
function loadPages() {
  const out = {};

  const add = (id, token, name) => {
    if (!id || !token) return;
    out[String(id).trim()] = {
      token: String(token).trim(),
      name: (name || "").trim()
    };
  };

  add(process.env.MESSENGER_PAGE_ID,
      process.env.MESSENGER_PAGE_TOKEN,
      process.env.MESSENGER_PAGE_NAME);

  for (let i = 2; i <= 6; i++) {
    add(process.env["MESSENGER_PAGE_ID_" + i],
        process.env["MESSENGER_PAGE_TOKEN_" + i],
        process.env["MESSENGER_PAGE_NAME_" + i]);
  }

  return out;
}

const PAGES = loadPages();

function tokenFor(pageId) {
  const p = PAGES[String(pageId)];
  return p ? p.token : "";
}

function nameFor(pageId) {
  const p = PAGES[String(pageId)];
  return p && p.name ? p.name : "";
}

export default async function handler(req, res) {
  // ---- Meta ki verification (sirf webhook set karte waqt) ----
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

  for (const entry of entries) {
    const pageId = String(entry.id || "");

    /* Sirf apne pages ke events. Pehle ek hi page qubool hota tha —
       ab har wo page jis ka token maujood hai. */
    if (!PAGES[pageId]) {
      console.log("Messenger: is page ka token nahi hai, chhoR diya:", pageId);
      continue;
    }

    // ---- Comments (feed webhook) ----
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const ch of changes) {
      if (ch.field !== "feed") continue;
      try {
        await handleFeed(db, ch.value, pageId);
      } catch (e) {
        console.error("Feed event skipped:", e.message);
      }
    }

    const events = Array.isArray(entry.messaging) ? entry.messaging : [];
    console.log("Messenger:", pageId, "| events:", events.length, "| feed:", changes.length);

    for (const ev of events) {
      try {
        if (ev.message && ev.message.is_echo) {
          await handleEcho(db, ev, pageId);
        } else if (ev.message) {
          await handleIncoming(db, ev, pageId);
        } else if (ev.postback) {
          await handlePostback(db, ev, pageId);
        }
      } catch (e) {
        console.error("Messenger event skipped:", e.message);
      }
    }
  }
}

// ============================================================
//  Student ka message aaya
// ============================================================
async function handleIncoming(db, ev, entryPageId) {
  const psid = ev.sender && ev.sender.id;
  if (!psid) return;

  const pageId = String((ev.recipient && ev.recipient.id) || entryPageId || "");

  /* Conversation ki ID wahi purani — fb_<PSID>.

     Badalne ki zaroorat nahi: Meta har page ke liye ALAG PSID deta
     hai. Ek hi banda dono pages ko message kare to us ke do alag
     PSID honge, is liye takrao ho hi nahi sakta.

     Aur badalne se nuqsan hota: maujooda saari Messenger chats ki ID
     alag ho jati aur wo dashboard se gum ho jatin. */
  const convoId = PREFIX + psid;
  const convoRef = db.collection("conversations").doc(convoId);
  const convoSnap = await convoRef.get();
  const isFirstEver = !convoSnap.exists;
  const prev = (convoSnap.exists && convoSnap.data()) || {};

  const parsed = parseMessage(ev.message);
  const now = new Date();

  let displayName = prev.displayName || "";
  if (!displayName) {
    displayName = await fetchProfileName(psid, pageId);
  }

  const convoData = {
    channel: "messenger",
    psid: psid,
    pageId: pageId,
    pageName: nameFor(pageId),      // inbox mein nishan ke liye
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

  await convoRef.collection("messages").add({
    direction: "in",
    channel: "messenger",
    type: parsed.type,
    text: parsed.text,
    waMessageId: (ev.message && ev.message.mid) || null,
    mediaUrlDirect: parsed.mediaUrlDirect,
    mediaId: null,
    mimeType: null,
    filename: parsed.filename,
    timestamp: now,
    expiresAt: new Date(now.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
  });
}

// ============================================================
//  Page ki taraf se gaya message (echo)
// ============================================================
async function handleEcho(db, ev, entryPageId) {
  const psid = ev.recipient && ev.recipient.id;
  if (!psid) return;

  const pageId = String((ev.sender && ev.sender.id) || entryPageId || "");
  const convoId = PREFIX + psid;
  const convoRef = db.collection("conversations").doc(convoId);
  const convoSnap = await convoRef.get();
  if (!convoSnap.exists) return;

  const prev = convoSnap.data() || {};
  const mid = (ev.message && ev.message.mid) || null;

  // Ek hi message do baar save na ho
  if (mid) {
    const dup = await convoRef
      .collection("messages")
      .where("waMessageId", "==", mid)
      .limit(1)
      .get();
    if (!dup.empty) {
      console.log("Messenger echo pehle se maujood:", mid);
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
    sentBy: "page-inbox",
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
//  Button dabaya
// ============================================================
async function handlePostback(db, ev, pageId) {
  const psid = ev.sender && ev.sender.id;
  if (!psid) return;

  const title = (ev.postback && (ev.postback.title || ev.postback.payload)) || "Button";
  await handleIncoming(db, {
    sender: ev.sender,
    recipient: ev.recipient,
    message: { mid: (ev.postback && ev.postback.mid) || null, text: title },
  }, pageId);
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
      out.type = "attachment";
    }
  }

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
//  Naam nikalna — usi page ke token se
// ============================================================
async function fetchProfileName(psid, pageId) {
  const token = tokenFor(pageId);
  if (!token) {
    console.log("Is page ka token nahi mila, naam skip:", pageId);
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
//  POST KI TAFSEEL
//
//  Comment ke saath Meta sirf post ka ID bhejta hai. Team ko us se
//  kuch pata nahi chalta ke comment kis cheez par aaya.
//
//  Ye function post ka asal matn, tasveer, tareekh aur link laata
//  hai — sab usi page ke token se.
//
//  Ek post par bees comment aa sakte hain, is liye ek dafa lane ke
//  baad us ko yaad rakh lete hain (CACHE). Har comment par dobara
//  Graph API call karna waqt aur kharcha dono zaya karta hai.
// ============================================================
const POST_CACHE = new Map();

async function fetchPost(postId, pageId) {
  if (!postId) return null;

  const key = pageId + ":" + postId;
  if (POST_CACHE.has(key)) return POST_CACHE.get(key);

  const token = tokenFor(pageId);
  if (!token) return null;

  try {
    const fields = "message,story,permalink_url,created_time,full_picture,attachments{type,title}";
    const url = `${GRAPH}/${postId}?fields=${fields}&access_token=${encodeURIComponent(token)}`;
    const r = await fetch(url);
    const d = await r.json();

    if (!r.ok) {
      console.log("Post nahi mila:", postId, JSON.stringify(d).slice(0, 200));
      POST_CACHE.set(key, null);
      return null;
    }

    const att = d.attachments && d.attachments.data && d.attachments.data[0];
    const out = {
      postMessage: (d.message || d.story || "").slice(0, 600),
      postPermalink: d.permalink_url || null,
      postImage: d.full_picture || null,
      postType: (att && att.type) || null,
      postCreatedAt: d.created_time ? new Date(d.created_time) : null,
    };

    POST_CACHE.set(key, out);
    return out;
  } catch (e) {
    console.log("Post fetch error:", e.message);
    return null;
  }
}

// ============================================================
//  COMMENTS — page ke post par kisi ne comment kiya
// ============================================================
async function handleFeed(db, v, pageId) {
  if (!v) return;

  if (v.item !== "comment") {
    console.log("Feed: item =", v.item, "— chhoR diya");
    return;
  }

  const commentId = v.comment_id;
  if (!commentId) return;

  const verb = v.verb || "add";
  const fromId = (v.from && v.from.id) || "";
  const myPage = String(pageId || "");

  // Apni hi page ka comment (team ka reply)
  if (fromId && myPage && String(fromId) === myPage) {
    console.log("Feed: apna hi comment, chhoR diya");
    return;
  }

  const ref = db.collection("comments").doc(String(commentId));

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
    createdAt: new Date(createdMs),
    updatedAt: now,
    pageId: myPage,
    pageName: nameFor(myPage),
    hidden: false,
    expiresAt: new Date(now.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
  };

  /* Post ki tafseel — sirf naye comment par. Purane comment par
     dobara lane ka koi faida nahi, post to wahi hai. */
  if (isNew && data.postId) {
    const post = await fetchPost(data.postId, myPage);
    if (post) Object.assign(data, post);
  }

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
  console.log("Comment saved:", commentId, "page:", myPage, "new:", isNew);
}
