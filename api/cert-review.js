// ============================================================
//  CERTIFICATE — TEAM KA FAISLA  (14 Sept 2026)
//
//  admin.html ka "Work review" yahan call karta hai. Sirf admins.
//
//  { uid, action, note }
//    action = "approve"   → certificate ban gaya (yahin banta hai)
//             "link_bad"  → dobara link de sakta hai (kul 2 mauqe)
//             "false"     → jhoot — khatam, dobara mauqa nahi
//
//  "false" sirf tab jab YAQEEN ho. Toota hua link ghalti hai, jhoot
//  nahi — us par "link_bad".
//
//  Certificate ka record: wahi jo pehle cert-submit.js banata tha.
//  certificates/{uid} par rules mein write band hai — sirf server.
// ============================================================

import { getDb } from "./_firebase.js";
import { getAuth } from "firebase-admin/auth";
import { pickBatch } from "./cert-submit.js";

const MAX_TRIES = 2;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const db = getDb();

    // ---- Login + admin check ----
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Login required" });

    let decoded;
    try {
      decoded = await getAuth().verifyIdToken(token);
    } catch (e) {
      return res.status(401).json({ error: "Invalid session" });
    }
    const adminSnap = await db.collection("admins").doc(decoded.uid).get();
    if (!adminSnap.exists) return res.status(403).json({ error: "Not authorized" });
    const adminName = adminSnap.data()?.name || decoded.email || "Team";

    const { uid, action } = req.body || {};
    const note = String((req.body || {}).note || "").trim().slice(0, 500);
    if (!uid || !["approve", "link_bad", "false"].includes(action)) {
      return res.status(400).json({ error: "uid and a valid action are required" });
    }
    if (action !== "approve" && !note) {
      return res.status(400).json({ error: "Please write a short reason for the student" });
    }

    const sRef = db.collection("students").doc(String(uid));
    const sSnap = await sRef.get();
    if (!sSnap.exists) return res.status(404).json({ error: "Student not found" });
    const s = sSnap.data() || {};

    if (String(s.workStatus || "") !== "pending") {
      return res.status(400).json({ error: "This student has nothing waiting for review" });
    }

    const { FieldValue } = await import("firebase-admin/firestore");
    const platformName = s.workPlatform === "tiktok" ? "TikTok" : "Facebook";

    // ============================================================
    //  APPROVE — certificate
    // ============================================================
    if (action === "approve") {
      const already = await db.collection("certificates").doc(String(uid)).get();
      if (already.exists) {
        await sRef.update({ workStatus: "approved", workBy: adminName, workAt: FieldValue.serverTimestamp() });
        return res.status(200).json({ ok: true, certNo: already.data().certNo, note: "already had one" });
      }

      const attAll = await db.collection("certificateAttempts").where("uid", "==", String(uid)).get();
      const attDoc = attAll.docs.find(d => d.data().passed === true);
      if (!attDoc) return res.status(400).json({ error: "This student has not passed the test" });
      const a = attDoc.data();

      /* Number aisa jo dohra na ho aur padha ja sake. Misaal: UTW-2026-4F7K2 */
      const y = new Date().getFullYear();
      const rnd = Math.random().toString(36).slice(2, 7).toUpperCase();
      const certNo = "UTW-" + y + "-" + rnd;

      await db.collection("certificates").doc(String(uid)).set({
        uid: String(uid),
        certNo,
        name: s.name || "",
        number: s.number || "",
        batch: pickBatch(s.batches),
        platform: s.workPlatform || "",
        workLink: s.workLink || "",
        score: a.score, total: a.total, pct: a.pct,
        attemptId: attDoc.id,
        issuedAt: FieldValue.serverTimestamp(),
        approvedBy: adminName,
        /* featured: null = abhi poocha nahi (student khud faisla karta hai) */
        featured: null
      }, { merge: false });

      await sRef.update({
        workStatus: "approved",
        workNote: "",
        workBy: adminName,
        workAt: FieldValue.serverTimestamp()
      });

      const nid = db.collection("notifications").doc();
      await nid.set({
        studentUid: String(uid),
        studentName: s.name || "",
        title: "Certificate issued",
        message: "Your " + platformName + " account was approved. Your certificate number is " + certNo
               + ". Open the Certificate page to view and print it.",
        isRead: false, isArchived: false,
        createdAt: FieldValue.serverTimestamp()
      });

      return res.status(200).json({ ok: true, certNo });
    }

    // ============================================================
    //  LINK THEEK NAHI — dobara mauqa (agar baqi ho)
    // ============================================================
    if (action === "link_bad") {
      const tries = Number(s.workTries || 0);
      const left = Math.max(0, MAX_TRIES - tries);
      await sRef.update({
        workStatus: "link_bad",
        workNote: note,
        workBy: adminName,
        workAt: FieldValue.serverTimestamp()
      });
      const nid = db.collection("notifications").doc();
      await nid.set({
        studentUid: String(uid),
        studentName: s.name || "",
        title: left ? "Your account link needs fixing" : "Your account link was not accepted",
        message: (note ? note + " " : "") + (left
          ? "Open the Certificate page and share the correct " + platformName + " link. You have " + left + " more chance."
          : "No more attempts are left for this step."),
        isRead: false, isArchived: false,
        createdAt: FieldValue.serverTimestamp()
      });
      return res.status(200).json({ ok: true, left });
    }

    // ============================================================
    //  JHOOT — khatam
    // ============================================================
    await sRef.update({
      workStatus: "false",
      workNote: note,
      workBy: adminName,
      workAt: FieldValue.serverTimestamp()
    });
    const nid = db.collection("notifications").doc();
    await nid.set({
      studentUid: String(uid),
      studentName: s.name || "",
      title: "Certificate request closed",
      message: note || "The account link you shared could not be accepted.",
      isRead: false, isArchived: false,
      createdAt: FieldValue.serverTimestamp()
    });
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error("CERT REVIEW ERROR:", err?.message || err);
    return res.status(500).json({ error: "Could not save the decision. Please try again." });
  }
}
