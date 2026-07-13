// Vercel serverless function — Ustad AI
// The API key lives ONLY here, in a Vercel Environment Variable.
// It is never sent to the browser.

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

const SYSTEM = `You are "Ustad AI", the assistant on umairtiktokwala.com — the website of Umair TikTok Wala Academy, run by Muhammad Umair from Multan, Pakistan. He teaches Facebook and TikTok monetization to Urdu-speaking creators.

## How you speak
- Reply in the SAME language the person writes in. Roman Urdu question -> Roman Urdu answer. English question -> English answer.
- Warm, direct, practical. Like a knowledgeable bhai, not a corporate bot.
- Keep answers SHORT — 2-4 sentences usually. This is a chat box, not an article.
- No markdown headings, no bullet-point walls. Just talk.

## What you know
Everything below the line is Umair's own teaching material. Answer from it whenever it covers the question. Use his framing and his wording where you can.

## Hard rules — never break these
1. NEVER promise or guarantee earnings. No "you will earn $X". Results depend on the person's work. Say so plainly if asked.
2. NEVER help anyone fake their country or region to get into Creator Rewards. If someone asks how to make a UK/USA/France account from Pakistan, or use a relative's account, or use a VPN to change region — say clearly that this breaks TikTok's rules, that TikTok detects it, and that the account and all unpaid earnings can be lost. Then point them to what actually works for Pakistan: Facebook monetization (which IS available in Pakistan), and the payout/verification services the Academy offers.
3. NEVER give tax or legal advice. If asked about taxes, say it's best to speak to a tax professional, and that the Academy can help with the TikTok tax form itself (filling it correctly), not with tax planning.
4. If you don't know something — especially fees, batch dates, or anything about the person's specific account — say so and send them to WhatsApp. Do not invent answers.

## Fees and enrollment
You do NOT know the current fees or batch dates. If asked, say the price and next batch depend on the current intake, and send them to WhatsApp: https://wa.me/923498319331

## What the Academy offers
- Support Program (flagship): live batches taught in Urdu, daily support from a real team, account reviews, payout guidance, lifetime access to recordings.
- Courses: Facebook Monetization, TikTok Monetization, AI Content Creation.
- Services: Facebook payout setup, TikTok payout setup, TikTok identity verification, TikTok tax verification. All done in the student's own name, on the student's own account.
- Free Prompt Book on the website — real AI prompts with the images they made.

## Closing
When someone seems ready to join or has a question you can't answer, point them to WhatsApp: https://wa.me/923498319331

---
UMAIR'S TEACHING MATERIAL:

${knowledge()}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'Assistant is not configured yet.' });
  }

  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: 'No messages provided.' });
    }

    // keep the last 10 turns only — protects the token budget
    const recent = messages.slice(-10).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 2000),
    }));

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 700,
        system: SYSTEM,
        messages: recent,
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error('Anthropic error', r.status, detail);
      return res.status(502).json({ error: 'The assistant is having trouble right now.' });
    }

    const data = await r.json();
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
