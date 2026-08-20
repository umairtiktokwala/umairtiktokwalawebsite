// ============================================================
//  FACEBOOK COMMENTS  —  reply / delete / hide / private reply
//  Dashboard ka Comments tab yahan call karta hai.
//
//  Zaroori Environment Variable:
//    MESSENGER_PAGE_TOKEN  = Page Access Token
// ============================================================

import { getDb } from "./_firebase.js";
import { getAuth } from "firebase-admin/auth";

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

    const { action, commentId, text } = req.body || {};
    if (!action || !commentId) {
      return res.status(400).json({ error: "Both action and commentId are required" });
    }

    const token = process.env.MESSENGER_PAGE_TOKEN;
    if (!token) {
      return res.status(500).json({ error: "MESSENGER_PAGE_TOKEN is not set" });
    }

    const ref = db.collection("comments").doc(String(commentId));
    const now = new Date();

    // ============================================================
    //  PUBLIC REPLY — comment ke neeche jawab
    // ============================================================
    if (action === "reply") {
      if (!text || !String(text).trim()) {
        return res.status(400).json({ error: "Reply is empty" });
      }

      const r = await fetch(`${GRAPH}/${commentId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: String(text),
          access_token: token,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        console.error("Comment reply failed:", JSON.stringify(data));
        return res.status(400).json({ error: friendly(data) });
      }

      await ref.set({
        status: "replied",
        replyText: String(text),
        replyId: data.id || null,
        repliedBy: agentName,
        repliedAt: now,
        unread: 0,
        updatedAt: now,
      }, { merge: true });

      return res.status(200).json({ ok: true });
    }

    // ============================================================
    //  PRIVATE REPLY — us bande ko Messenger pe DM
    //  Meta ke qawaid: har comment pe sirf EK dafa, aur 7 din ke andar.
    // ============================================================
    if (action === "private") {
      if (!text || !String(text).trim()) {
        return res.status(400).json({ error: "Message is empty" });
      }

      const snap = await ref.get();
      if (snap.exists && snap.data().privateReplySent) {
        return res.status(400).json({
          error: "A private reply has already been sent for this comment. Meta allows only one. Continue in the Chats tab.",
        });
      }

      const r = await fetch(`${GRAPH}/${commentId}/private_replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: String(text),
          access_token: token,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        console.error("Private reply failed:", JSON.stringify(data));
        return res.status(400).json({ error: friendly(data) });
      }

      await ref.set({
        privateReplySent: true,
        privateReplyText: String(text),
        privateReplyBy: agentName,
        privateReplyAt: now,
        unread: 0,
        updatedAt: now,
      }, { merge: true });

      return res.status(200).json({ ok: true });
    }

    // ============================================================
    //  HIDE / UNHIDE — comment chhupana
    // ============================================================
    if (action === "hide" || action === "unhide") {
      const r = await fetch(`${GRAPH}/${commentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_hidden: action === "hide",
          access_token: token,
        }),
      });
      const data = await r.json();
      if (!r.ok) return res.status(400).json({ error: friendly(data) });

      await ref.set({
        hidden: action === "hide",
        hiddenBy: agentName,
        updatedAt: now,
      }, { merge: true });

      return res.status(200).json({ ok: true });
    }

    // ============================================================
    //  DELETE — comment hamesha ke liye khatam
    // ============================================================
    if (action === "delete") {
      const r = await fetch(
        `${GRAPH}/${commentId}?access_token=${encodeURIComponent(token)}`,
        { method: "DELETE" }
      );
      const data = await r.json();
      if (!r.ok) {
        console.error("Comment delete failed:", JSON.stringify(data));
        return res.status(400).json({ error: friendly(data) });
      }

      await ref.set({
        status: "deleted",
        deletedBy: agentName,
        deletedAt: now,
        unread: 0,
        updatedAt: now,
      }, { merge: true });

      return res.status(200).json({ ok: true });
    }

    // ============================================================
    //  MARK READ — sirf dashboard ke liye, Meta pe kuch nahi jata
    // ============================================================
    if (action === "read") {
      await ref.set({ unread: 0, updatedAt: now }, { merge: true });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Unknown action: " + action });
  } catch (err) {
    console.error("Comment action error:", err);
    return res.status(500).json({ error: "Action could not be completed" });
  }
}

// Meta ki angrezi error ko aasan Roman Urdu mein badalna
function friendly(data) {
  const e = (data && data.error) || {};
  const msg = e.message || "Facebook rejected the request";

  if (/private_replies|outside.*window|7 day/i.test(msg)) {
    return "Private reply failed. Meta allows only one private reply per comment, within 7 days of the comment.";
  }
  if (e.code === 190 || /access token/i.test(msg)) {
    return "Page token is expired or invalid. Generate a new token in Meta and update it in Vercel.";
  }
  if (e.code === 200 || /permission/i.test(msg)) {
    return "Permission not granted yet. This needs pages_manage_engagement / pages_read_user_content, which are pending App Review.";
  }
  if (/does not exist|Unsupported/i.test(msg)) {
    return "This comment no longer exists — the person may have deleted it.";
  }
  return msg;
}
