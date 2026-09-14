/**
 * api/read-claim.js
 * Umair TikTok Wala — PayPal Service
 *
 * KYA KARTA HAI
 * finance.html se claim ka screenshot yahan aata hai. Ye us tasveer ko
 * Claude se parhwa kar do number wapas bhejta hai:
 *
 *   gross  — upar wala bara amount (TikTok ne kitna dikhaya)
 *   fee    — Service fee
 *
 * Student ko in mein se kuch chunna nahi parta. Dono khane khud bhar jate
 * hain, aur wo sirf dekh kar Submit dabata hai.
 *
 * KEY YAHAN KYUN
 * Browser mein key rakhna khatarnak hai — safha koi bhi khol kar dekh sakta
 * hai. Ye file Vercel ke server par chalti hai, is liye key mehfooz rehti hai.
 * Key sirf Vercel ki Environment Variables mein hai, code mein kahin nahi.
 *
 * SETUP (ek dafa)
 *   Vercel > Project > Settings > Environment Variables
 *   Name : ANTHROPIC_API_KEY
 *   Value: sk-ant-...
 *   Phir Deployments > ... > Redeploy
 *
 * NAKAAM HO JAYE TO
 * Ye hamesha 200 hi bhejta hai, khali jawab ke saath. finance.html us surat
 * mein khane khali chhor deta hai aur student khud likh leta hai. Claim ka
 * rasta kabhi rukta nahi — AI sirf madad hai, shart nahi.
 */

const MODEL       = 'claude-sonnet-4-6';
const MAX_IMAGE_B = 5 * 1024 * 1024;   // 5 MB, finance.html ki hadd jitna
const TIMEOUT_MS  = 11000;             // browser 12 second par chhor deta hai

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/* Tasveer mein sirf ye dekhna hai. Jo saaf na ho usay null rakhna hai —
   ghalat andaza lagane se behtar hai ke student khud likh le. */
const PROMPT = [
  'This is a screenshot of a TikTok creator payout.',
  '',
  'Find these two figures:',
  '  gross — the large amount at the top of the screen (the payout amount)',
  '  fee   — the value on the "Service fee" line',
  '',
  'Rules:',
  '- Return numbers only, no currency symbol, no commas.',
  '- If a figure is not clearly visible, return null for it.',
  '- Do not calculate or guess anything. Only report what is printed.',
  '- If this is not a TikTok payout screen, return null for both.',
  '',
  'Reply with JSON only, nothing else, in exactly this shape:',
  '{"gross": 38.16, "fee": 0.57}'
].join('\n');

/** Khali jawab — har nakaami par yehi jata hai. */
function blank(res, why) {
  return res.status(200).json({ gross: null, fee: null, ok: false, why: why || '' });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error('read-claim: ANTHROPIC_API_KEY is not set in Vercel');
    return blank(res, 'not-configured');
  }

  const body      = req.body || {};
  const image     = typeof body.image === 'string' ? body.image : '';
  let   mediaType = typeof body.mediaType === 'string' ? body.mediaType : 'image/jpeg';

  if (!image) return blank(res, 'no-image');

  if (!ALLOWED_TYPES.includes(mediaType)) mediaType = 'image/jpeg';

  // base64 asal bytes se taqreeban ek tihai bara hota hai
  if (image.length * 0.75 > MAX_IMAGE_B) return blank(res, 'too-large');

  const stop  = new AbortController();
  const timer = setTimeout(() => stop.abort(), TIMEOUT_MS);

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':          key,
        'anthropic-version': '2023-06-01'
      },
      signal: stop.signal,
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
            { type: 'text',  text: PROMPT }
          ]
        }]
      })
    });

    clearTimeout(timer);

    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('read-claim: Anthropic HTTP ' + r.status + ' ' + detail.slice(0, 300));
      return blank(res, 'api-' + r.status);
    }

    const data = await r.json();

    const text = (data.content || [])
      .filter(x => x && x.type === 'text')
      .map(x => x.text || '')
      .join('')
      .trim();

    // Kabhi kabhi jawab ```json ke andar aata hai — wo hata dete hain
    const clean = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) return blank(res, 'no-json');

    let parsed;
    try { parsed = JSON.parse(match[0]); }
    catch (e) { return blank(res, 'bad-json'); }

    const gross = toMoney(parsed.gross);
    const fee   = toMoney(parsed.fee);

    // Gross ke baghair kuch faida nahi
    if (gross === null) return blank(res, 'no-gross');

    // Fee gross se barabar ya zyada ho to kuch ghalat parha gaya hai
    if (fee !== null && fee >= gross) {
      return res.status(200).json({ gross: gross, fee: 0, ok: true });
    }

    return res.status(200).json({ gross: gross, fee: fee === null ? 0 : fee, ok: true });

  } catch (e) {
    clearTimeout(timer);
    console.error('read-claim: ' + (e && e.message ? e.message : e));
    return blank(res, 'failed');
  }
}

/** Number hi le, aur wo bhi maqool hadd mein. Warna null. */
function toMoney(v) {
  if (v === null || v === undefined) return null;

  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  if (!isFinite(n) || n < 0) return null;
  if (n > 100000) return null;           // itni bari raqam yaqeenan ghalat parhi gayi

  return Math.round(n * 100) / 100;
}
