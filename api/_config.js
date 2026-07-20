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
//  ENROLLMENT FORMS
//  Link badalna ho to sirf yahan badlein — neeche har jagah
//  khud ba khud update ho jayega.
// ============================================================

const FB_FORM = "https://forms.gle/WXoE9YomdWWiEbee6";
const TT_FORM = "https://forms.gle/hQ5H7apHVdXoSuuYA";

const BOTH_FORMS =
  "Facebook Support Program:\n" + FB_FORM + "\n\n" +
  "TikTok Support Program:\n" + TT_FORM;

// ============================================================
//  KEYWORD LIST
//  - keywords: jo lafz message mein aayen (chhote huroof mein likhein)
//  - reply: jo jawab jayega
//  Upar wali entry pehle check hoti hai. Nayi entry add karni ho to
//  bas comma ke baad naya { } block likh dein.
// ============================================================

export const AUTO_REPLIES = [
  // ---- Fees ----
  {
    keywords: ["fees", "fee", "price", "qeemat", "kitne paise", "kitni fees", "charges"],
    reply:
      "Support Program ki fees *3000 PKR* hai — 3 mahine ke liye.\n\n" +
      "Facebook aur TikTok dono ki fees alag alag hai. Course aur support group " +
      "bhi dono ke alag hain.\n\n" +
      "Join karne ke liye form fill karein:\n\n" + BOTH_FORMS,
  },

  // ---- Batch / start date ----
  {
    keywords: ["batch", "kab shuru", "start", "starting", "next batch", "admission open"],
    reply:
      "Naya batch *25 July* se shuru ho raha hai.\n\n" +
      "Registration ke liye form fill karein:\n\n" + BOTH_FORMS,
  },

  // ---- Join / enroll ----
  {
    keywords: [
      "join", "enroll", "enrol", "registration", "register", "admission",
      "shamil", "dakhla", "form"
    ],
    reply:
      "Support Program join karne ke liye form fill kar dein:\n\n" + BOTH_FORMS + "\n\n" +
      "Facebook ka course chahiye to Facebook wala form, TikTok ka chahiye to " +
      "TikTok wala form bharein.\n\n" +
      "Fees: 3000 PKR (3 mahine)\n" +
      "Batch: 25 July se",
  },

  // ---- Course ----
  {
    keywords: ["course", "class lena", "seekhna", "sikhna", "training"],
    reply:
      "Course join karne ke liye Support Program wala form fill karein:\n\n" + BOTH_FORMS + "\n\n" +
      "Facebook ka course chahiye to Facebook wala form, TikTok ka chahiye to " +
      "TikTok wala form.\n\n" +
      "Note: Facebook aur TikTok dono ke course aur group alag hain, fees bhi alag.",
  },

  // ---- Payment ----
  {
    keywords: ["payment", "account", "bank", "transfer", "easypaisa", "jazzcash", "paisay bhejne"],
    reply:
      "Payment ki saari details form mein maujood hain — form fill karte waqt " +
      "aap ko mil jayengi:\n\n" + BOTH_FORMS + "\n\n" +
      "Payment ke baad transaction ID aur apna naam yahan bhej dein, " +
      "team verify kar degi.",
  },

  // ---- Timings ----
  {
    keywords: ["timing", "time", "waqt", "kab class", "class time", "schedule", "kitne baje"],
    reply:
      "Support group ka time: *subha 8 baje se 2 baje tak*\n" +
      "Recorded classes: *4 baje tak* upload ho jati hain\n\n" +
      "Classes recorded hain — apni marzi se jab chahein dekh sakte hain.",
  },

  // ---- Facebook vs TikTok difference ----
  {
    keywords: ["dono", "difference", "farq", "separate", "alag", "kaunsa behtar"],
    reply:
      "Facebook aur TikTok dono programs *alag alag* hain:\n\n" +
      "- Fees alag (3000 PKR har ek ki)\n" +
      "- Course alag\n" +
      "- Support group alag\n\n" +
      "Jo bhi karna ho us ka form fill karein:\n\n" + BOTH_FORMS,
  },

  // ---- Portal / login ----
  {
    keywords: ["login", "password", "learn", "portal", "lms", "dashboard"],
    reply:
      "Learning portal yahan hai:\n" +
      "https://umairtiktokwala.com/learn.html\n\n" +
      "Login ka masla ho to apna registered email likhein, team check kar degi.",
  },
];

// ============================================================
//  SURVEY (masla hal hua ya nahi)
//  Team "Send survey" button dabati hai, ye message student ko jata hai.
// ============================================================

export const SURVEY_MESSAGE =
  "Kya aap ka masla hal ho gaya?\n\n" +
  "1 = Haan, shukriya\n" +
  "2 = Nahi, abhi bhi masla hai\n\n" +
  "Sirf number likh kar bhej dein.";

// Student "1" likhe to ye jawab jayega
export const SURVEY_REPLY_YES =
  "Shukriya! Aap ka feedback humare liye ahem hai.\n\n" +
  "Koi aur sawal ho to kabhi bhi message karein.";

// Student "2" likhe to ye jawab jayega (chat wapas team ke paas aa jayegi)
export const SURVEY_REPLY_NO =
  "Maazrat. Hamari team dobara aap se rabta karegi.\n\n" +
  "Apna masla thora tafseel se likh dein taake behtar madad kar sakein.";

// ============================================================
//  LABELS
//  Chat pe lagane ke liye. Naya label add karna ho to yahan likh dein.
//  AHEM: yehi list inbox.html mein bhi hai — dono jagah same rakhein.
//  color: blue / green / amber / red / purple / grey
// ============================================================

export const LABELS = [
  { id: "new_inquiry",      name: "New inquiry",      color: "purple" },
  { id: "payment_pending",  name: "Payment pending",  color: "amber"  },
  { id: "payment_verified", name: "Payment verified", color: "green"  },
  { id: "enrolled",         name: "Enrolled",         color: "blue"   },
  { id: "technical",        name: "Technical issue",  color: "red"    },
  { id: "follow_up",        name: "Follow up",        color: "amber"  },
  { id: "resolved",         name: "Resolved",         color: "grey"   },
];

// ============================================================
//  DATA CLEANUP
//  Itne din baad purani chats khud delete ho jayengi
// ============================================================

export const MESSAGE_RETENTION_DAYS = 7;
