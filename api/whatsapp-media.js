// ============================================================
//  MEDIA PROXY
//  Meta ka media URL public nahi hota — har baar token chahiye.
//  Ye function beech mein khara ho kar media dashboard tak pohanchata hai.
//
//  Istemal: /api/whatsapp-media?id=MEDIA_ID&token=ID_TOKEN
//
//  --- 3 Aug 2026: CACHE KA MASLA THEEK KIYA ---
//  Pehle cache sirf 1 ghante ka tha, is liye team jab bhi koi chat
//  kholti thi to wohi image/video dobara Vercel se guzarti thi.
//  Us se Vercel ka "Fast Origin Transfer" (10 GB/mahina) bhar raha tha.
//
//  Ab do cheezein hain:
//    s-maxage  -> Vercel ka apna CDN media sambhal leta hai,
//                 yani ye function dobara chalta hi nahi
//    max-age   -> browser bhi 30 din tak apne paas rakhta hai
//
//  Ye mehfooz hai kyunke ek media ID ka content kabhi badalta nahi.
//  (Meta 30 din baad media delete kar deta hai — us waqt naya ID banta hai.)
// ============================================================

import { getDb } from "./_firebase.js";
import { getAuth } from "firebase-admin/auth";

const GRAPH = "https://graph.facebook.com/v21.0";

// 30 din — Meta bhi itna hi rakhta hai
const CACHE_SECONDS = 30 * 24 * 60 * 60;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const mediaId = req.query.id;
  const idToken = req.query.token;

  if (!mediaId) return res.status(400).json({ error: "Media id chahiye" });
  if (!idToken) return res.status(401).json({ error: "Login required" });

  try {
    // ---- Login check ----
    const db = getDb();
    let decoded;
    try {
      decoded = await getAuth().verifyIdToken(idToken);
    } catch (e) {
      return res.status(401).json({ error: "Invalid session" });
    }

    const adminSnap = await db.collection("admins").doc(decoded.uid).get();
    if (!adminSnap.exists) return res.status(403).json({ error: "Not authorized" });

    // ---- Step 1: media ka asli URL lein ----
    const metaRes = await fetch(`${GRAPH}/${mediaId}`, {
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
    });

    if (!metaRes.ok) {
      const err = await metaRes.json().catch(() => ({}));
      // 30 din purana media Meta delete kar deta hai.
      // Error ko thora sa cache karein taake gayab media baar baar
      // function na chalaye — magar zyada nahi, shayad waqti masla ho.
      res.setHeader("Cache-Control", "public, max-age=300");
      return res.status(404).json({
        error: err?.error?.message || "Media nahi mila (shayad 30 din purana hai)",
      });
    }

    const meta = await metaRes.json();
    if (!meta.url) {
      res.setHeader("Cache-Control", "public, max-age=300");
      return res.status(404).json({ error: "Media URL nahi mila" });
    }

    // ---- Step 2: file download karein ----
    const fileRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
    });

    if (!fileRes.ok) {
      return res.status(502).json({ error: "Media download nahi ho saka" });
    }

    const buf = Buffer.from(await fileRes.arrayBuffer());
    const mime =
      meta.mime_type ||
      fileRes.headers.get("content-type") ||
      "application/octet-stream";

    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", buf.length);

    // ---- YEHI ASLI FIX HAI ----
    // s-maxage      : Vercel ke CDN ke liye — function dobara nahi chalega
    // max-age       : browser ke liye
    // immutable     : browser dobara poochega bhi nahi
    // Media ID kabhi badalti nahi, is liye ye bilkul mehfooz hai.
    res.setHeader(
      "Cache-Control",
      `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}, immutable`
    );
    // Vercel ka apna header — CDN ko saaf batata hai
    res.setHeader("CDN-Cache-Control", `public, s-maxage=${CACHE_SECONDS}`);
    // Har media ID ka apna cache
    res.setHeader("ETag", `"wa-${mediaId}"`);

    // Document ho to download ka naam bhi de dein
    if (req.query.download === "1") {
      const name = (req.query.name || "file").replace(/[^\w.\-]/g, "_");
      res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    }

    return res.status(200).send(buf);
  } catch (err) {
    console.error("Media error:", err);
    return res.status(500).json({ error: "Media laane mein masla" });
  }
}
