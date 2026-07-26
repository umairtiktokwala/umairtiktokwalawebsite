// File path: /api/send-whatsapp.js   (Vercel project root ke andar "api" folder)
//
// Environment variables (Vercel > Settings > Environment Variables):
//   WHATSAPP_TOKEN            = permanent System User token
//   WHATSAPP_PHONE_NUMBER_ID  = Meta App > WhatsApp > API Setup se "Phone number ID"
//   GRAPH_VERSION             = v21.0   (optional)

const GRAPH_VERSION = process.env.GRAPH_VERSION || "v21.0";

/**
 * Pakistani number ko Meta ke format me badalta hai.
 * 03001234567  -> 923001234567
 * +923001234567 -> 923001234567
 */
function normalizeNumber(raw) {
  let n = String(raw || "").replace(/[^\d]/g, ""); // sirf digits

  if (n.startsWith("0")) n = "92" + n.slice(1);   // 0300... -> 92300...
  if (n.startsWith("920")) n = "92" + n.slice(3); // 920300... -> 92300...

  return n;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Only POST allowed" });
  }

  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    return res.status(500).json({
      ok: false,
      error: "Server par WHATSAPP_TOKEN ya WHATSAPP_PHONE_NUMBER_ID set nahi hai",
    });
  }

  const { to, text } = req.body || {};

  if (!to || !text) {
    return res.status(400).json({ ok: false, error: "'to' aur 'text' dono zaroori hain" });
  }

  const recipient = normalizeNumber(to);

  try {
    const metaRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: recipient,
          type: "text",
          text: { preview_url: false, body: text },
        }),
      }
    );

    const data = await metaRes.json();

    // Meta ne reject kar diya -> asli wajah frontend tak wapas bhejo
    if (!metaRes.ok) {
      const err = data.error || {};
      console.error("Meta reject:", JSON.stringify(data));

      return res.status(metaRes.status).json({
        ok: false,
        code: err.code,               // 190 = token expired, 131030 = allowed list, etc.
        subcode: err.error_subcode,
        error: err.message || "Meta ne message reject kar diya",
        details: err.error_data?.details || null,
      });
    }

    // Kamyab
    return res.status(200).json({
      ok: true,
      messageId: data.messages?.[0]?.id || null,
      to: recipient,
    });
  } catch (e) {
    console.error("Send failed:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
