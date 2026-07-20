// Firebase Admin SDK setup — server side Firestore access
// Ye file khud kaam karti hai, ise edit karne ki zaroorat nahi.

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

let db;

export function getDb() {
  if (db) return db;

  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT environment variable missing");
    }
    const serviceAccount = JSON.parse(raw);

    initializeApp({
      credential: cert({
        projectId: serviceAccount.project_id,
        clientEmail: serviceAccount.client_email,
        privateKey: serviceAccount.private_key.replace(/\\n/g, "\n"),
      }),
    });
  }

  db = getFirestore();
  return db;
}

// Phone number ko ek hi shakal mein laane ke liye:
// +92 300 1234567  →  3001234567
// 923001234567     →  3001234567
// 03001234567      →  3001234567
export function normalizePhone(input) {
  if (!input) return "";
  const digits = String(input).replace(/\D/g, "");
  return digits.slice(-10);
}

// WhatsApp number se student ka record dhoondna
// Pehle numbers/{phone} lookup, phir students collection
export async function findStudent(waNumber) {
  const database = getDb();
  const short = normalizePhone(waNumber);
  if (!short) return null;

  // Raasta 1: numbers collection (document ID hi number hai)
  const candidates = [waNumber, "92" + short, short, "0" + short];
  for (const id of candidates) {
    try {
      const snap = await database.collection("numbers").doc(String(id)).get();
      if (snap.exists) {
        const email = snap.data().email;
        if (email) {
          const q = await database
            .collection("students")
            .where("email", "==", email)
            .limit(1)
            .get();
          if (!q.empty) return shapeStudent(q.docs[0]);
        }
      }
    } catch (e) {
      // aage barhte hain
    }
  }

  // Raasta 2: phone10 field (aakhri 10 digit) — sab se mehfooz tareeqa
  // Country code ho ya na ho, dono soorat mein match ho jata hai.
  try {
    const q = await database
      .collection("students")
      .where("phone10", "==", short)
      .limit(1)
      .get();
    if (!q.empty) return shapeStudent(q.docs[0]);
  } catch (e) {
    // aage barhte hain
  }

  // Raasta 3: purana number field (jin records mein phone10 nahi hai)
  for (const val of ["92" + short, short, "0" + short]) {
    try {
      const q = await database
        .collection("students")
        .where("number", "==", val)
        .limit(1)
        .get();
      if (!q.empty) return shapeStudent(q.docs[0]);
    } catch (e) {
      // aage barhte hain
    }
  }

  return null;
}

function shapeStudent(doc) {
  const d = doc.data() || {};
  const enrollments = Array.isArray(d.enrollments) ? d.enrollments : [];
  const courses = [];
  const batches = [];

  for (const en of enrollments) {
    if (en && en.batch) batches.push(en.batch);
    if (en && Array.isArray(en.courses)) courses.push(...en.courses);
  }
  if (Array.isArray(d.batches)) {
    for (const b of d.batches) if (!batches.includes(b)) batches.push(b);
  }

  return {
    id: doc.id,
    name: d.name || "",
    email: d.email || "",
    number: d.number || "",
    verified: d.verified === true,
    batches,
    courses: [...new Set(courses)],
  };
}
