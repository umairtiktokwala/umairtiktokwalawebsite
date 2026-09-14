// ============================================================
//  CERTIFICATE TEST — SHURU
//
//  Ye API ye kaam karti hai:
//    1. Dekhti hai ke student qualify karta hai ya nahi (chhe shartein)
//    2. Platform chunwati hai — Facebook ya TikTok (ek dafa)
//    3. 30 sawal chunti hai aur bhejti hai — JAWAB KE BAGAIR
//    4. Test ke baad batati hai ke aage kya hai — link dena, team ka
//       intezar, manzoor, ya radd
//
//  ---- SAWAL BROWSER MEIN KYUN NAHI BANATE ----
//  Sheet ka CSV link public hota hai. Agar safha khud sheet parhta, to
//  jawab bhi browser tak aa jate — F12 daba kar koi bhi dekh leta.
//  Is liye sheet sirf yahan (server par) parhi jati hai. Jawab Firestore
//  mein rakhe jate hain, browser ko sirf sawal jate hain.
//
//  ---- 14 SEPT 2026 — NAYA NIZAAM ----
//  * Platform: student pehle Facebook ya TikTok chunta hai. Sawal usi
//    ke: general (52) + us platform ke (35). Baad mein link bhi usi
//    platform ka maanga jata hai.
//  * Timer: har sawal par 30 SECOND — SERVER ka waqt. Har jawab
//    api/cert-answer par jata hai; server dekhta hai ke pichle sawal
//    se ab tak kitna waqt guzra. Der ho gayi to jawab khali ginta hai.
//    Wapas jane ka koi raasta nahi. Maqsad: koi AI se poochh na sake.
//  * Paas hone par certificate NAHI banta. Student apne account ka
//    link deta hai (api/cert-work), team dekhti hai (api/cert-review),
//    Approve par certificate banta hai.
//
//  ---- SHARTEIN (chhe, sab poori honi chahiyen) ----
//    1. Course 100% mukammal
//    2. Kam se kam ek task APPROVE hua ho
//    3. Profile mukammal — naam, city, tasveer
//    4. Portal par kam se kam 50 ghante
//    5. Kam se kam 30 alag din portal khola ho (10+ minute wale)
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
const DAY_MIN       = 10 * 60;   // ek din ginne ke liye kam se kam 10 minute

/* Scholarship ka counter kis tareekh se shuru hota hai.
   Is se pehle ka waqt aur din certificate ke liye shumar nahi hote.
   Khali ("") kar dein to poora record dobara ginne lagega.
   AHEM: yehi tareekh leaderboard-build.js mein bhi hai — dono barabar rakhein. */
const COUNT_FROM    = "2026-09-13";
const NEED_PCT      = 100;
const QUESTIONS     = 30;
const PASS_PCT      = 70;
const MAX_ATTEMPTS  = 3;
const COOLDOWN_DAYS = 7;

/* Har sawal ka waqt (second) — aur 3 second ki chhoot network ke liye.
   Yehi number cert-answer.js mein bhi hai. */
export const Q_SECONDS = 30;
export const Q_GRACE   = 3;

const PLATFORMS = ["facebook", "tiktok"];
const MAX_LINK_TRIES = 2;

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

const ms = t => (t && t.toMillis) ? t.toMillis() : (t instanceof Date ? t.getTime() : Number(t || 0));

/* Adhoore test mein "ab kahan hain" — aur jo sawal waqt guzarne se
   chhoot gaye un ko khali gin kar aage barh jana.
   Wapas aata hai: { cur, curAt, given, changed } */
function catchUp(a, now) {
  const total = Number(a.total || (a.questions || []).length);
  let cur = Number(a.cur || 0);
  const given = Array.isArray(a.given) ? a.given.slice() : new Array(total).fill(0);
  while (given.length < total) given.push(0);
  /* Timer abhi shuru hi nahi hua (student ne "Start" nahi dabaya) —
     kuch nahi ginna */
  if (!ms(a.curAt)) return { cur, curAt: null, given, changed: false };
  let curAt = ms(a.curAt);
  let changed = false;
  const limit = (Q_SECONDS + Q_GRACE) * 1000;
  while (cur < total && now - curAt > limit) {
    given[cur] = 0;          // waqt guzar gaya — khali
    cur++;
    curAt += limit;          // agla sawal usi waqt shuru hua tha
    changed = true;
  }
  if (cur >= total) cur = total;
  if (changed && cur < total) curAt = now;   // jo sawal ab saamne hai, us ka waqt ab se
  return { cur, curAt, given, changed };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    /* AHEM: getDb() PEHLE. Wahi Firebase app ko initialize karta hai.
       Agar getAuth() us se pehle chale to har bande ko "Session expired"
       milta hai chahe wo abhi abhi login hua ho. */
    const db = getDb();

    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Not signed in" });

    let uid;
    try {
      uid = (await getAuth().verifyIdToken(token)).uid;
    } catch (e) {
      console.error("TOKEN FAIL:", e?.message || e);
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }

    const { FieldValue } = await import("firebase-admin/firestore");
    const now = Date.now();

    /* ---- Certificate pehle se mil chuka? ---- */
    const done = await db.collection("certificates").doc(uid).get();
    if (done.exists) {
      const d = done.data();
      return res.status(200).json({
        state: "certified",
        certNo: d.certNo || "",
        score: d.score, total: d.total, pct: d.pct,
        featured: (d.featured === true || d.featured === false) ? d.featured : null,
        issuedAt: d.issuedAt ? d.issuedAt.toDate().toISOString() : null
      });
    }

    /* ---- Student ka record ---- */
    const sRef = db.collection("students").doc(uid);
    const sSnap = await sRef.get();
    if (!sSnap.exists) return res.status(404).json({ error: "Student record not found" });
    const s = sSnap.data() || {};

    if (s.suspended === true) {
      return res.status(403).json({ error: "This account is not active." });
    }

    /* ---- Platform chunna (body mein aaye to likh do) ----
       Ek dafa chun liya to badla nahi ja sakta — sawal aur link dono
       usi par khare hain. */
    const wantPlatform = String((req.body || {}).platform || "").toLowerCase();
    if (wantPlatform && PLATFORMS.includes(wantPlatform) && !PLATFORMS.includes(s.workPlatform)) {
      await sRef.update({ workPlatform: wantPlatform, workPlatformAt: FieldValue.serverTimestamp() });
      s.workPlatform = wantPlatform;
    }
    const platform = PLATFORMS.includes(s.workPlatform) ? s.workPlatform : null;

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
    const hasPhoto = String(s.photo || s.photoURL || s.photoUrl || "").trim().length > 0;
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

    /* 4 + 5. Ghante aur din — dono ek hi jagah se.
       Din tabhi ginte hain jab us tareekh par kam se kam DAY_MIN
       waqt guzara ho. */
    const daysSnap = await sRef.collection("days").get();
    let seconds = 0, activeDays = 0;
    daysSnap.forEach(d => {
      if (COUNT_FROM && d.id < COUNT_FROM) return;
      const n = Number(d.data()?.seconds || 0);
      if (n > 0) seconds += n;
      if (n >= DAY_MIN) activeDays++;
    });
    const hours = seconds / 3600;

    checks.push({
      key: "hours", ok: hours >= NEED_HOURS,
      label: "Spend time in the portal",
      now: Math.floor(hours) + "h", need: NEED_HOURS + "h"
    });
    checks.push({
      key: "days", ok: activeDays >= NEED_DAYS,
      label: "Keep coming back (10+ min a day)",
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

    // 7. Platform
    checks.push({
      key: "platform", ok: !!platform,
      label: "Choose your platform",
      now: platform ? (platform === "facebook" ? "Facebook" : "TikTok") : "not chosen",
      need: "Facebook or TikTok"
    });

    /* ---- Koshishein ---- */
    const attSnap = await db.collection("certificateAttempts")
      .where("uid", "==", uid).get();

    const attempts = [];
    attSnap.forEach(d => attempts.push({ id: d.id, ...d.data() }));
    attempts.sort((a, b) => (b.startedAt?.toMillis?.() || 0) - (a.startedAt?.toMillis?.() || 0));

    const finished = attempts.filter(a => a.submittedAt && !a.retired);
    const passedAtt = attempts.find(a => a.submittedAt && a.passed === true);
    const open = attempts.find(a => !a.submittedAt);

    // 8. Test
    const best = finished.length ? Math.max(...finished.map(a => Number(a.score || 0))) : 0;
    checks.push({
      key: "test", ok: !!passedAtt,
      label: "Pass the certificate test",
      now: passedAtt ? "passed " + passedAtt.score + "/" + passedAtt.total
         : !eligible ? "locked"
         : finished.length ? "best " + best + "/" + QUESTIONS + ", "
                           + Math.max(0, MAX_ATTEMPTS - finished.length) + " attempt(s) left"
         : "not started",
      need: Math.ceil(QUESTIONS * PASS_PCT / 100) + "/" + QUESTIONS
    });

    // 9. Team ki manzoori
    const ws = String(s.workStatus || "");
    checks.push({
      key: "work", ok: ws === "approved",
      label: "Share your account link for review",
      now: ws === "approved" ? "approved"
         : ws === "pending" ? "under review"
         : ws === "link_bad" ? "link needs fixing"
         : ws === "false" ? "not accepted"
         : "not sent",
      need: "team approval"
    });

    const base = { checks, countFrom: COUNT_FROM, platform, qSeconds: Q_SECONDS, now };

    /* ---- Test paas ho chuka — ab link ka marhala ---- */
    if (passedAtt) {
      const work = {
        platform,
        link: s.workLink || "",
        status: ws || "none",
        note: s.workNote || "",
        tries: Number(s.workTries || 0),
        maxTries: MAX_LINK_TRIES,
        score: passedAtt.score, total: passedAtt.total, pct: passedAtt.pct
      };
      if (ws === "false" || (ws === "link_bad" && work.tries >= MAX_LINK_TRIES)) {
        return res.status(200).json({ ...base, state: "work_rejected", work });
      }
      if (ws === "pending") {
        return res.status(200).json({ ...base, state: "work_pending", work });
      }
      // none ya link_bad (mauqa baqi) — link maango
      return res.status(200).json({ ...base, state: "passed_link", work });
    }

    if (!eligible) {
      return res.status(200).json({ ...base, state: "not_eligible" });
    }

    /* Platform abhi nahi chuna — pehle wo */
    if (!platform) {
      return res.status(200).json({ ...base, state: "choose_platform" });
    }

    /* Adhoora test — wahin se, naye sawal nahi. Jo sawal waqt mein
       chhoot gaye wo khali gin liye jate hain. */
    if (open) {
      const cu = catchUp(open, now);
      if (cu.changed) {
        await db.collection("certificateAttempts").doc(open.id)
          .update({ cur: cu.cur, curAt: new Date(cu.curAt), given: cu.given });
      }
      return res.status(200).json({
        ...base,
        state: "in_progress",
        attemptId: open.id,
        questions: open.questions,
        cur: cu.cur,
        curAt: cu.curAt,
        attemptNo: finished.length + 1,
        maxAttempts: MAX_ATTEMPTS,
        passPct: PASS_PCT
      });
    }

    if (finished.length >= MAX_ATTEMPTS) {
      const last = finished[0]?.submittedAt?.toMillis?.() || 0;
      const openAt = last + COOLDOWN_DAYS * 864e5;
      if (now < openAt) {
        return res.status(200).json({
          ...base,
          state: "locked",
          attempts: finished.length,
          maxAttempts: MAX_ATTEMPTS,
          opensAt: new Date(openAt).toISOString(),
          best
        });
      }
      /* 7 din guzar gaye — purani koshishein band kar dete hain */
      const batch = db.batch();
      finished.forEach(a => {
        batch.update(db.collection("certificateAttempts").doc(a.id), { retired: true });
      });
      await batch.commit();
    }

    /* ---- Sawal — sheet se, sirf general + chune huay platform ke ----
       Sheet: Course | Level | Question | Option 1-4 | Correct
       Course = general / facebook / tiktok */
    const csv = await fetch(CERT_CSV + "&_cb=" + Date.now(), { cache: "no-store" });
    if (!csv.ok) throw new Error("sheet " + csv.status);
    const rows = parseCSV(await csv.text()).slice(1);

    const bank = rows.map(r => ({
      course: (r[0] || "").trim().toLowerCase(),
      level:  (r[1] || "").trim().toLowerCase(),
      q:      (r[2] || "").trim(),
      opts:   [r[3], r[4], r[5], r[6]].map(x => (x || "").trim()),
      right:  parseInt((r[7] || "").trim(), 10)
    })).filter(x => x.q && x.opts[0] && x.opts[1] && x.right >= 1 && x.right <= 4)
      .filter(x => !x.course || x.course === "general" || x.course === platform);

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

    /* Options bhi ghumate hain — warna jawab hamesha ek hi jagah rehta */
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
    const startedAt = new Date(now);
    await ref.set({
      uid,
      studentName: s.name || "",
      number: s.number || "",
      platform,
      questions: forStudent,   // jawab is mein NAHI hain
      answers,                 // ye sirf server parhta hai
      given: new Array(forStudent.length).fill(0),   // student ke jawab, cert-answer bharta hai
      cur: 0,                  // kaunsa sawal saamne hai
      curAt: null,             // pehle sawal ka waqt — "Start" dabane par
                               // cert-answer {begin:true} isay set karta hai
      qSeconds: Q_SECONDS,
      total: forStudent.length,
      passPct: PASS_PCT,
      attemptNo: finished.length + 1,
      startedAt,
      submittedAt: null,
      score: null,
      passed: null
    });

    return res.status(200).json({
      ...base,
      state: "ready",
      attemptId: ref.id,
      questions: forStudent,
      cur: 0,
      curAt: null,
      attemptNo: finished.length + 1,
      maxAttempts: MAX_ATTEMPTS,
      passPct: PASS_PCT
    });

  } catch (err) {
    console.error("CERT START ERROR:", err?.message || err);
    return res.status(500).json({ error: "Could not start the test. Please try again." });
  }
}
