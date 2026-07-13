// Vercel serverless function — verify a student's phone number
//
// The browser NEVER sees the Apps Script secret, and never sees the
// verified-students list. It only ever learns: is THIS number paid, and
// for which courses.
//
// Needs two Vercel Environment Variables:
//   SHEET_SCRIPT_URL  = your Apps Script /exec URL
//   SHEET_SECRET      = the SECRET string from your Apps Script

const SCRIPT_URL = process.env.SHEET_SCRIPT_URL;
const SECRET = process.env.SHEET_SECRET;

// ---- rate limit: stop anyone brute-forcing numbers ----
const HITS = new Map();
const LIMIT = 20;              // checks
const WINDOW = 60 * 60 * 1000; // per hour

function overLimit(ip) {
  const now = Date.now();
  const rec = HITS.get(ip);
  if (!rec || now - rec.start > WINDOW) {
    HITS.set(ip, { start: now, n: 1 });
    return false;
  }
  rec.n += 1;
  if (HITS.size > 2000) HITS.clear();
  return rec.n > LIMIT;
}

function normalize(n) {
  n = String(n || '').replace(/\D/g, '');
  if (n.startsWith('0')) n = '92' + n.slice(1);
  if (n.startsWith('3') && n.length === 10) n = '92' + n;
  return n;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!SCRIPT_URL || !SECRET) {
    console.error('SHEET_SCRIPT_URL or SHEET_SECRET is missing');
    return res.status(503).json({
      error: 'Verification abhi set nahi hui. WhatsApp par rabta karein.',
    });
  }

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  if (overLimit(ip)) {
    return res.status(429).json({
      error: 'Bohat koshishein ho gayin. Thori der baad try karein.',
    });
  }

  const number = normalize((req.body || {}).number);
  if (!number || number.length < 11) {
    return res.status(400).json({ error: 'Number theek nahi lag raha.' });
  }

  try {
    const r = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: SECRET, number }),
      redirect: 'follow',
    });

    if (!r.ok) throw new Error('script ' + r.status);

    const data = await r.json();
    if (data.error) throw new Error(data.error);

    // Only ever return the minimum: verified yes/no, which courses, their name.
    return res.status(200).json({
      verified: !!data.verified,
      courses: Array.isArray(data.courses) ? data.courses : [],
      name: String(data.name || '').slice(0, 60),
    });
  } catch (err) {
    console.error('verify failed:', err.message);
    return res.status(502).json({
      error: 'Verification abhi kaam nahi kar rahi. Thori der baad try karein.',
    });
  }
}
