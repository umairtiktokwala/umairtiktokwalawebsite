// ============================================================
//  AUTO-REPLY SETTINGS
//  Is file ko kabhi bhi edit kar sakte hain.
//  Save kar ke Vercel pe deploy karein, foran kaam karega.
// ============================================================

// Pehli baar message karne wale ko ye jayega
export const WELCOME_MESSAGE =
  "Welcome to Umair TikTok Wala Academy\n\n" +
  "Assalam o alaikum, apki kia help kr skta hun me ?";

// Welcome message on/off
export const WELCOME_ENABLED = true;

// Keyword replies on/off
export const KEYWORDS_ENABLED = true;

// Ek hi keyword ka jawab dobara bhejne se pehle itne minute ka wait
// (taake student baar baar "fees" likhe to spam na ho)
export const KEYWORD_COOLDOWN_MINUTES = 30;

// ============================================================
//  KEYWORD LIST
//  - keywords: jo lafz message mein aayen (chhote huroof mein likhein)
//  - reply: jo jawab jayega
//  Upar wali entry pehle check hoti hai. Nayi entry add karni ho to
//  bas comma ke baad naya { } block likh dein.
// ============================================================

export const AUTO_REPLIES = [
  {
    keywords: ["fees", "fee", "price", "qeemat", "kitne paise", "kitna"],
    reply:
      "Support Program ki fees aur details ke liye ye page dekhein:\n" +
      "https://umairtiktokwala.com\n\n" +
      "Koi aur sawal ho to likhein, team jawab degi.",
  },
  {
    keywords: ["batch", "class", "admission", "enroll", "registration"],
    reply:
      "Naye batch ki tareekh aur registration ki tafseel yahan hai:\n" +
      "https://umairtiktokwala.com\n\n" +
      "Team thori der mein aap se rabta karegi.",
  },
  {
    keywords: ["payment", "account", "bank", "transfer", "easypaisa", "jazzcash"],
    reply:
      "Payment ke baad apni transaction ID aur naam yahan bhej dein — " +
      "team verify kar ke aap ko batch mein add kar degi.",
  },
  {
    keywords: ["login", "password", "learn", "portal", "lms"],
    reply:
      "Learning portal yahan hai:\nhttps://umairtiktokwala.com/learn.html\n\n" +
      "Login ka masla ho to apna registered email likhein.",
  },
];

// ============================================================
//  DATA CLEANUP
//  Itne din baad purani chats khud delete ho jayengi
// ============================================================

export const MESSAGE_RETENTION_DAYS = 7;
