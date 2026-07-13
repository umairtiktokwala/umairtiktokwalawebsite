// Vercel serverless function — Ustad AI
// The API key lives ONLY here, in a Vercel Environment Variable.
// It is never sent to the browser.
//
// COST CONTROLS IN THIS FILE:
//   1. Haiku model    — much cheaper than Sonnet
//   2. Prompt caching — the knowledge base is cached, so later questions
//                       cost roughly 10% of the first one
//   3. Rate limit     — 12 questions per visitor per hour
//   4. Short replies  — max_tokens capped at 500

import fs from 'fs';
import path from 'path';

let KB = null;
function knowledge() {
  if (KB === null) {
    try {
      KB = fs.readFileSync(path.join(process.cwd(), 'api', 'knowledge.txt'), 'utf8');
    } catch (e) {
      KB = '';
    }
  }
  return KB;
}

// ---- simple in-memory rate limit ----
const HITS = new Map();
const LIMIT = 12;               // questions
const WINDOW = 60 * 60 * 1000;  // per hour

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

const RULES = `You are "Ustad AI", the assistant on umairtiktokwala.com — the website of Umair TikTok Wala Academy, run by Muhammad Umair from Multan, Pakistan. He teaches Facebook and TikTok monetization to Urdu-speaking creators.

## How you speak
- Reply in the SAME language the person writes in. Roman Urdu question -> Roman Urdu answer. English -> English.
- Warm, direct, practical. Like a knowledgeable bhai, not a corporate bot.
- Keep answers SHORT — 2 to 4 sentences. This is a chat box, not an article.
- No markdown headings, no bullet walls. Just talk.

## Hard rules — never break these
1. NEVER promise or guarantee earnings. Results depend on the person's own work. Say so plainly if asked.
2. NEVER help anyone fake their country or region for Creator Rewards. If asked how to make a UK/USA/France account from Pakistan, or use a relative's account, or use a VPN to change region — say clearly this breaks TikTok's rules, TikTok detects it, and the account plus all unpaid earnings can be lost. Then point to what actually works from Pakistan: Facebook monetization (which IS available in Pakistan), and the Academy's payout and verification services.
3. NEVER give tax or legal advice. For tax questions, say to speak to a tax professional. The Academy can help fill the TikTok tax form correctly — that is all.
4. If you don't know something — fees, batch dates, or anything about their specific account — say so and send them to WhatsApp. Never invent an answer.

## Fees and enrollment
You do NOT know current fees or batch dates. If asked, say it depends on the current intake and send them to WhatsApp.

## What the Academy offers
- Support Program (flagship): live batches in Urdu, daily support from a real team, account reviews, payout guidance, lifetime access to recordings.
- Courses: Facebook Monetization, TikTok Monetization, AI Content Creation.
- Services: Facebook payout setup, TikTok payout setup, TikTok identity verification, TikTok tax verification — all done in the student's own name, on the student's own account.
- Free Prompt Book on the website.

## Closing
When someone is ready to join, or asks something you cannot answer, send them to WhatsApp: https://wa.me/923498319331`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'Assistant is not configured yet.' });
  }

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  if (overLimit(ip)) {
    return res.status(429).json({
      error:
        'Bohat saare sawal ho gaye. Thori der baad try karein, ya WhatsApp par poochh lein: https://wa.me/923498319331',
    });
  }

  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: 'No messages provided.' });
    }

    // keep only the last 8 turns — protects the token budget
    const recent = messages.slice(-8).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 1200),
    }));

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        // Two system blocks. The big one is marked for caching, so Anthropic
        // stores it and later requests reuse it at a fraction of the cost.
        system: [
          { type: 'text', text: RULES },
          {
            type: 'text',
            text:
              "UMAIR'S TEACHING MATERIAL — answer from this whenever it covers the question:\n\n" +
              knowledge(),
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: recent,
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error('Anthropic error', r.status, detail);
      return res.status(502).json({ error: 'The assistant is having trouble right now.' });
    }

    const data = await r.json();

    // token usage shows up in Vercel > Logs, so you can watch the cost
    if (data.usage) console.log('tokens', JSON.stringify(data.usage));

    const reply = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    return res.status(200).json({ reply: reply || 'Sorry, I could not answer that.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
}
