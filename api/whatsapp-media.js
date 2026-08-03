// ============================================================
//  MEDIA PROXY
//  Meta ka media URL public nahi hota — har baar token chahiye.
//  Ye function beech mein khara ho kar media dashboard tak pohanchata hai.
//
//  Istemal: /api/whatsapp-media?id=MEDIA_ID
//  Note: Meta media sirf 30 din rakhta hai, us ke baad ghayab.
// ============================================================

import { getDb } from "./_firebase.js";
import { getAuth } from "firebase-admin/auth";

const GRAPH = "https://graph.facebook.com/v21.0";

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
      // 30 din purana media Meta delete kar deta hai
      return res.status(404).json({
        error: err?.error?.message || "Media nahi mila (shayad 30 din purana hai)",
      });
    }

    const meta = await metaRes.json();
    if (!meta.url) return res.status(404).json({ error: "Media URL nahi mila" });

    // ---- Step 2: file download karein ----
    const fileRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
    });

    if (!fileRes.ok) {
      return res.status(502).json({ error: "Media download nahi ho saka" });
    }

    const buf = Buffer.from(await fileRes.arrayBuffer());
    const mime = meta.mime_type || fileRes.headers.get("content-type") || "application/octet-stream";

    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", buf.length);
    // Browser thori der cache kar le taake baar baar download na ho
    res.setHeader("Cache-Control", "private, max-age=3600");

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
