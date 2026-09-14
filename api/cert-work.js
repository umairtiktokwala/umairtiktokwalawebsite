// ============================================================
//  CERTIFICATE — ACCOUNT KA LINK  (14 Sept 2026)
//
//  Test paas hote hi certificate nahi milta. Student apne account ka
//  link deta hai — USI platform ka jo us ne test se pehle chuna tha.
//  Team dekhti hai (api/cert-review.js): account us ka apna hai,
//  videos hain, 30 din se kaam ho raha hai.
//
//  Kul DO mauqe. "Link theek nahi" par dobara de sakta hai; doosri
//  dafa bhi theek na ho to khatam. "Jhoot" par pehli dafa hi khatam.
//
//  students/{uid} mein:
//    workPlatform  facebook | tiktok        (cert-start ne likha)
//    workLink      student ka link
//    workStatus    pending | approved | link_bad | false
//    workNote      team ki wajah
//    workTries     kitni dafa link diya (hadd 2)
//    workAt        kab
//
//  Rules mein student workStatus/workNote/workBy/workAt/workTries khud
//  nahi likh sakta — ye file Admin SDK se likhti hai.
// ============================================================

import { getDb } from "./_firebase.js";
import { getAuth } from "firebase-admin/auth";

const MAX_TRIES = 2;

/* Link platform ka hi ho — Facebook ya TikTok ka */
function okLink(platform, url) {
  let u;
  try { u = new URL(url); } catch (e) { return false; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const h = u.hostname.toLowerCase();
  if (platform === "facebook") {
    return /(^|\.)facebook\.com$/.test(h) || /(^|\.)fb\.com$/.test(h) || h === "fb.watch" || /(^|\.)fb\.watch$/.test(h);
  }
  if (platform === "tiktok") {
    return /(^|\.)tiktok\.com$/.test(h) || h === "vm.tiktok.com" || h === "vt.tiktok.com";
  }
  return false;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const db = getDb();

    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Not signed in" });

    let uid;
    try {
      uid = (await getAuth().verifyIdToken(token)).uid;
    } catch (e) {
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }

    const link = String((req.body || {}).link || "").trim();
    if (!link) return res.status(400).json({ error: "Please paste the link to your account" });
    if (link.length > 500) return res.status(400).json({ error: "That link is too long" });

    /* Certificate pehle se hai? */
    const cert = await db.collection("certificates").doc(uid).get();
    if (cert.exists) return res.status(400).json({ error: "You already have a certificate" });

    /* Test paas hai? */
    /* Sirf uid par query — do where lagane se Firestore alag index
       maangta hai. passed yahin dekh lete hain. */
    const attAll = await db.collection("certificateAttempts").where("uid", "==", uid).get();
    const passedAtt = attAll.docs.find(d => d.data().passed === true);
    if (!passedAtt) return res.status(403).json({ error: "Pass the test first" });

    const sRef = db.collection("students").doc(uid);
    const sSnap = await sRef.get();
    if (!sSnap.exists) return res.status(404).json({ error: "Student record not found" });
    const s = sSnap.data() || {};

    const platform = s.workPlatform === "tiktok" ? "tiktok" : (s.workPlatform === "facebook" ? "facebook" : "");
    if (!platform) return res.status(400).json({ error: "Choose your platform first" });

    const ws = String(s.workStatus || "");
    const tries = Number(s.workTries || 0);

    if (ws === "approved") return res.status(400).json({ error: "Your link is already approved" });
    if (ws === "pending")  return res.status(400).json({ error: "Your link is already under review" });
    if (ws === "false")    return res.status(403).json({ error: "This request has been closed" });
    if (tries >= MAX_TRIES) return res.status(403).json({ error: "No more attempts left" });

    if (!okLink(platform, link)) {
      return res.status(400).json({
        error: platform === "tiktok"
          ? "Please paste a TikTok link (tiktok.com/@yourname)"
          : "Please paste a Facebook link (facebook.com/yourpage)"
      });
    }

    const { FieldValue } = await import("firebase-admin/firestore");
    await sRef.update({
      workLink: link,
      workStatus: "pending",
      workNote: "",
      workTries: tries + 1,
      workAt: FieldValue.serverTimestamp(),
      workBy: FieldValue.delete()
    });

    return res.status(200).json({ ok: true, status: "pending", tries: tries + 1, maxTries: MAX_TRIES });

  } catch (err) {
    console.error("CERT WORK ERROR:", err?.message || err);
    return res.status(500).json({ error: "Could not save your link. Please try again." });
  }
}
