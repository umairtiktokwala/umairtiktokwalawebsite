// ============================================================
//  CERTIFICATE TEST — SHURU
//
//  Ye API do kaam karti hai:
//    1. Dekhti hai ke student qualify karta hai ya nahi
//    2. 30 sawal chunti hai aur bhejti hai — JAWAB KE BAGAIR
//
//  ---- SAWAL BROWSER MEIN KYUN NAHI BANATE ----
//  Sheet ka CSV link public hota hai. Agar safha khud sheet parhta, to
//  jawab bhi browser tak aa jate — F12 daba kar koi bhi dekh leta.
//  Is liye sheet sirf yahan (server par) parhi jati hai. Jawab Firestore
//  mein rakhe jate hain, browser ko sirf sawal jate hain.
//
//  ---- SHARTEIN (chhe, sab poori honi chahiyen) ----
//    1. Course 100% mukammal
//    2. Kam se kam ek task APPROVE hua ho
//    3. Profile mukammal — naam, city, tasveer
//    4. Portal par kam se kam 50 ghante
//    5. Kam se kam 30 alag din portal khola ho
//    6. Kam se kam ek investment darj ki ho
//
//  ---- MAUQE ----
//  3 koshish. Teeno mein fail ho to 7 din baad dobara khulta hai.
//  Paas ka meyar 70% — yaani 30 mein se 21.
// ============================================================

import { getDb } from "./_firebase.js";
import { getAuth } from "firebase-admin/auth";

const CERT_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQi8wumBYZU4E63ABiPCji2pGEBgr5gkZl3tqob1RfDsAI4zwW-o-rQy51P_0m0-GEq2oeLD2p6wQ5u/pub?output=csv";

const NEED_HOURS    = 50;
const NEED_DAYS     = 30;
const NEED_PCT      = 100;
const QUESTIONS     = 30;
const PASS_PCT      = 70;
const MAX_ATTEMPTS  = 3;
const COOLDOWN_DAYS = 7;

/* CSV parhna — comma aur quote dono sambhalta hai */
function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", q = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (c !== "\r") cell += c;
    }
    i++;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function shuffle(a) {
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    /* ---- Kaun hai? ----
       ID token se pehchante hain. Bina is ke koi bhi kisi doosre
       student ke naam par test shuru kar sakta tha. */
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Not signed in" });

    let uid;
    try {
      uid = (await getAuth().verifyIdToken(token)).uid;
    } catch (e) {
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }

    const db = getDb();

    /* ---- Certificate pehle se mil chuka? ---- */
    const done = await db.collection("certificates").doc(uid).get();
    if (done.exists) {
      const d = done.data();
      return res.status(200).json({
        state: "certified",
        score: d.score, total: d.total,
        issuedAt: d.issuedAt ? d.issuedAt.toDate().toISOString() : null
      });
    }

    /* ---- Student ka record ---- */
    const sSnap = await db.collection("students").doc(uid).get();
    if (!sSnap.exists) return res.status(404).json({ error: "Student record not found" });
    const s = sSnap.data() || {};

    if (s.suspended === true) {
      return res.status(403).json({ error: "This account is not active." });
    }

    /* ---- Shartein ---- */
    const checks = [];

    // 1. Course
    const pct = Number(s.courseStats?.pct || 0);
    checks.push({
      key: "course", ok: pct >= NEED_PCT,
      label: "Finish the whole course",
      now: pct + "%", need: NEED_PCT + "%"
    });

    // 2. Approved task
    const subs = await db.collection("submissions")
      .where("uid", "==", uid).where("status", "==", "approved").limit(1).get();
    checks.push({
      key: "task", ok: !subs.empty,
      label: "Have at least one task approved",
      now: subs.empty ? "none yet" : "done", need: "1"
    });

    // 3. Profile
    const hasName  = String(s.name || "").trim().length >= 3;
    const hasCity  = String(s.city || "").trim().length >= 2;
    const hasPhoto = String(s.photo || s.photoURL || "").trim().length > 0;
    const missing = [];
    if (!hasName) missing.push("name");
    if (!hasCity) missing.push("city");
    if (!hasPhoto) missing.push("photo");
    checks.push({
      key: "profile", ok: missing.length === 0,
      label: "Complete your profile",
      now: missing.length ? "missing " + missing.join(", ") : "complete",
      need: "name, city, photo"
    });

    // 4 + 5. Ghante aur din — dono ek hi jagah se
    const daysSnap = await db.collection("students").doc(uid).collection("days").get();
    let seconds = 0, activeDays = 0;
    daysSnap.forEach(d => {
      const n = Number(d.data()?.seconds || 0);
      if (n > 0) { seconds += n; activeDays++; }
    });
    const hours = seconds / 3600;

    checks.push({
      key: "hours", ok: hours >= NEED_HOURS,
      label: "Spend time in the portal",
      now: Math.floor(hours) + "h", need: NEED_HOURS + "h"
    });
    checks.push({
      key: "days", ok: activeDays >= NEED_DAYS,
      label: "Keep coming back",
      now: activeDays + " days", need: NEED_DAYS + " days"
    });

    // 6. Investment
    const inv = await db.collection("investments")
      .where("uid", "==", uid).limit(1).get();
    checks.push({
      key: "investment", ok: !inv.empty,
      label: "Record at least one investment",
      now: inv.empty ? "none yet" : "done", need: "1"
    });

    const eligible = checks.every(c => c.ok);
    if (!eligible) {
      return res.status(200).json({ state: "not_eligible", checks });
    }

    /* ---- Koshishein ---- */
    const attSnap = await db.collection("certificateAttempts")
      .where("uid", "==", uid).get();

    const attempts = [];
    attSnap.forEach(d => attempts.push({ id: d.id, ...d.data() }));
    attempts.sort((a, b) => (b.startedAt?.toMillis?.() || 0) - (a.startedAt?.toMillis?.() || 0));

    const finished = attempts.filter(a => a.submittedAt);
    const open = attempts.find(a => !a.submittedAt);

    /* Adhoora test — wahi wapas de dete hain, naye sawal nahi.
       Warna student refresh kar ke aasan sawal dhoond leta. */
    if (open) {
      return res.status(200).json({
        state: "in_progress",
        attemptId: open.id,
        questions: open.questions,
        attemptNo: finished.length + 1,
        maxAttempts: MAX_ATTEMPTS,
        passPct: PASS_PCT
      });
    }

    if (finished.length >= MAX_ATTEMPTS) {
      const last = finished[0]?.submittedAt?.toMillis?.() || 0;
      const openAt = last + COOLDOWN_DAYS * 864e5;
      if (Date.now() < openAt) {
        return res.status(200).json({
          state: "locked",
          attempts: finished.length,
          maxAttempts: MAX_ATTEMPTS,
          opensAt: new Date(openAt).toISOString(),
          best: Math.max(...finished.map(a => Number(a.score || 0)))
        });
      }
      /* 7 din guzar gaye — purani koshishein band kar dete hain taake
         ginti dobara sifar se shuru ho */
      const batch = db.batch();
      finished.forEach(a => {
        batch.update(db.collection("certificateAttempts").doc(a.id), { retired: true });
      });
      await batch.commit();
    }

    /* ---- Sawal ---- */
    const csv = await fetch(CERT_CSV + "&_cb=" + Date.now(), { cache: "no-store" });
    if (!csv.ok) throw new Error("sheet " + csv.status);
    const rows = parseCSV(await csv.text()).slice(1);

    const bank = rows.map(r => ({
      level: (r[1] || "").trim().toLowerCase(),
      q:     (r[2] || "").trim(),
      opts:  [r[3], r[4], r[5], r[6]].map(x => (x || "").trim()),
      right: parseInt((r[7] || "").trim(), 10)
    })).filter(x => x.q && x.opts[0] && x.opts[1] && x.right >= 1 && x.right <= 4);

    if (bank.length < QUESTIONS) {
      return res.status(500).json({ error: "The question bank is not ready yet." });
    }

    // 10 asaan, 10 darmiyana, 10 mushkil — kami ho to baqi se poora
    const by = l => shuffle(bank.filter(x => x.level === l));
    let set = [...by("easy").slice(0, 10), ...by("medium").slice(0, 10), ...by("hard").slice(0, 10)];
    if (set.length < QUESTIONS) {
      const rest = shuffle(bank.filter(x => !set.includes(x)));
      set = set.concat(rest.slice(0, QUESTIONS - set.length));
    }
    set = shuffle(set).slice(0, QUESTIONS);

    /* Options bhi ghumate hain — warna jawab hamesha ek hi jagah rehta
       aur teen koshishon mein pattern samajh aa jata. */
    const forStudent = [], answers = [];
    set.forEach((x, i) => {
      const order = shuffle([0, 1, 2, 3]).filter(k => x.opts[k]);
      forStudent.push({
        n: i + 1,
        q: x.q,
        opts: order.map(k => x.opts[k])
      });
      answers.push(order.indexOf(x.right - 1) + 1);
    });

    const ref = db.collection("certificateAttempts").doc();
    const { FieldValue } = await import("firebase-admin/firestore");
    await ref.set({
      uid,
      studentName: s.name || "",
      number: s.number || "",
      questions: forStudent,   // jawab is mein NAHI hain
      answers,                 // ye sirf server parhta hai
      total: forStudent.length,
      passPct: PASS_PCT,
      attemptNo: finished.length + 1,
      startedAt: FieldValue.serverTimestamp(),
      submittedAt: null,
      score: null,
      passed: null
    });

    return res.status(200).json({
      state: "ready",
      attemptId: ref.id,
      questions: forStudent,
      attemptNo: finished.length + 1,
      maxAttempts: MAX_ATTEMPTS,
      passPct: PASS_PCT
    });

  } catch (err) {
    console.error("CERT START ERROR:", err?.message || err);
    return res.status(500).json({ error: "Could not start the test. Please try again." });
  }
}
