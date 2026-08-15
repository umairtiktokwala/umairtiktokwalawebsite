// ============================================================
//  SEND MEDIA
//  Team dashboard se image / document bhejti hai.
//  Do step: pehle Meta pe upload, phir message bhejein.
//
//  SIZE KI ASLI HAD:
//  Vercel ki serverless function ek request mein sirf 4.5 MB leti hai.
//  Ye Vercel ki apni had hai — code se badli nahi ja sakti.
//  File base64 mein badalne se ~33% aur bhaari ho jati hai,
//  is liye asli had ~3.3 MB banti hai. Hum ne 3 MB rakhi hai.
//
//  (Pehle yahan `export const config = { api: { bodyParser: ... } }`
//   likha tha — wo Next.js ki line hai. Ye project Next.js nahi hai,
//   is liye us line ka koi asar nahi tha. Hata di gayi hai.)
// ============================================================

import { getDb, normalizePhone } from "./_firebase.js";
import { getAuth } from "firebase-admin/auth";

const GRAPH = "https://graph.facebook.com/v21.0";

// Har qism ke liye ek hi had — kyunke rukawat Vercel ki taraf se hai,
// WhatsApp ki taraf se nahi.
const MAX_BYTES = 3 * 1024 * 1024;

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

    const { to, dataUrl, filename, caption } = req.body || {};
    if (!to || !dataUrl) {
      return res.status(400).json({ error: "Number aur file dono chahiye" });
    }

    // ---- data URL parse karein ----
    const m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return res.status(400).json({ error: "File theek nahi" });

    const mime = m[1];
    const buf = Buffer.from(m[2], "base64");

    if (buf.length > MAX_BYTES) {
      const mb = (buf.length / 1024 / 1024).toFixed(1);
      return res.status(400).json({
        error: `File 3 MB se bari hai (${mb} MB). Chhoti kar ke bhejein.`,
      });
    }

    // Jis number pe student ne message kiya tha, usi se jayega.
    // (24-ghante ka window har number ka alag hota hai — galat number se
    //  bheja jaye to Meta reject kar deta hai.)
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

    // ---- Kis qism ki file hai ----
    let waType = "document";
    if (mime.startsWith("image/") && mime !== "image/svg+xml") waType = "image";
    else if (mime.startsWith("video/")) waType = "video";
    else if (mime.startsWith("audio/")) waType = "audio";

    // ---- Step 1: Meta pe upload ----
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("file", new Blob([buf], { type: mime }), filename || "file");
    form.append("type", mime);

    const upRes = await fetch(
      `${GRAPH}/${fromId}/media`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
        body: form,
      }
    );

    const upData = await upRes.json();
    if (!upRes.ok || !upData.id) {
      console.error("Media upload failed:", JSON.stringify(upData));
      return res.status(400).json({
        error: upData?.error?.message || "Upload nahi ho saka",
      });
    }

    // ---- Step 2: message bhejein ----
    const payload = {
      messaging_product: "whatsapp",
      to,
      type: waType,
      [waType]: { id: upData.id },
    };
    // Audio pe caption WhatsApp support nahi karta
    if (caption && (waType === "image" || waType === "video" || waType === "document")) {
      payload[waType].caption = String(caption).slice(0, 1000);
    }
    if (waType === "document" && filename) {
      payload.document.filename = filename;
    }

    const sendRes = await fetch(
      `${GRAPH}/${fromId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    const sendData = await sendRes.json();
    if (!sendRes.ok) {
      console.error("Media send failed:", JSON.stringify(sendData));
      return res.status(400).json({
        error: sendData?.error?.message || "Message nahi gaya",
      });
    }

    // ---- Firestore mein save ----
    const convoId = normalizePhone(to) || to;
    const now = new Date();
    const convoRef = db.collection("conversations").doc(convoId);

    await convoRef.collection("messages").add({
      direction: "out",
      type: waType,
      text: caption || "",
      mediaId: upData.id,
      mimeType: mime,
      filename: filename || null,
      waMessageId: sendData.messages?.[0]?.id || null,
      sentBy: agentName,
      status: "sent",
      timestamp: now,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    });

    const label = waType === "image" ? "📷 Image"
      : waType === "video" ? "🎥 Video"
      : waType === "audio" ? "🎵 Audio"
      : "📄 " + (filename || "Document");

    await convoRef.set(
      {
        lastMessage: caption ? label + " — " + caption.slice(0, 60) : label,
        lastMessageAt: now,
        unread: 0,
        awaitingReply: false,
        assignedTo: agentName,
        assignedUid: decoded.uid,
        updatedAt: now,
      },
      { merge: true }
    );

    return res.status(200).json({ ok: true, mediaId: upData.id });
  } catch (err) {
    console.error("Send media error:", err);
    return res.status(500).json({ error: "File nahi ja saki" });
  }
}
