// Test endpoint — masla dhoondne ke liye
// Browser mein kholein: /api/whatsapp-test?secret=utw2026
// Kaam ho jaye to ye file delete kar dein

export default async function handler(req, res) {
  const secret = req.query.secret;
  if (secret !== "utw2026") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const result = {
    step1_env_vars: {},
    step2_json_parse: null,
    step3_firebase_init: null,
    step4_firestore_write: null,
    step5_whatsapp_token: null,
  };

  // ---- Step 1: environment variables maujood hain? ----
  result.step1_env_vars = {
    WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN ? "OK (" + process.env.WHATSAPP_TOKEN.length + " chars)" : "MISSING",
    WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || "MISSING",
    WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN ? "OK" : "MISSING",
    FIREBASE_SERVICE_ACCOUNT: process.env.FIREBASE_SERVICE_ACCOUNT
      ? "OK (" + process.env.FIREBASE_SERVICE_ACCOUNT.length + " chars)"
      : "MISSING",
  };

  // ---- Step 2: JSON parse ho rahi hai? ----
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    result.step2_json_parse = {
      status: "OK",
      project_id: serviceAccount.project_id,
      client_email: serviceAccount.client_email,
      has_private_key: !!serviceAccount.private_key,
      private_key_starts: serviceAccount.private_key
        ? serviceAccount.private_key.slice(0, 30)
        : "MISSING",
    };
  } catch (e) {
    result.step2_json_parse = { status: "FAILED", error: e.message };
    return res.status(200).json(result);
  }

  // ---- Step 3: Firebase initialize ----
  try {
    const { initializeApp, getApps, cert } = await import("firebase-admin/app");
    if (!getApps().length) {
      initializeApp({
        credential: cert({
          projectId: serviceAccount.project_id,
          clientEmail: serviceAccount.client_email,
          privateKey: serviceAccount.private_key.replace(/\\n/g, "\n"),
        }),
      });
    }
    result.step3_firebase_init = { status: "OK" };
  } catch (e) {
    result.step3_firebase_init = { status: "FAILED", error: e.message };
    return res.status(200).json(result);
  }

  // ---- Step 4: Firestore mein likhna ----
  try {
    const { getFirestore } = await import("firebase-admin/firestore");
    const db = getFirestore();
    await db.collection("conversations").doc("test-entry").set({
      test: true,
      createdAt: new Date(),
      lastMessage: "Test entry — delete kar sakte hain",
      lastMessageAt: new Date(),
      waNumber: "0000000000",
      displayName: "Test",
      unread: 0,
    });
    result.step4_firestore_write = { status: "OK — conversations/test-entry bana diya" };
  } catch (e) {
    result.step4_firestore_write = { status: "FAILED", error: e.message };
    return res.status(200).json(result);
  }

  // ---- Step 5: WhatsApp token check ----
  try {
    const r = await fetch(
      `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}?fields=display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
    );
    const data = await r.json();
    result.step5_whatsapp_token = r.ok
      ? { status: "OK", number: data.display_phone_number, name: data.verified_name }
      : { status: "FAILED", error: data?.error?.message };
  } catch (e) {
    result.step5_whatsapp_token = { status: "FAILED", error: e.message };
  }

  return res.status(200).json(result);
}
