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
  // ---- Enroll / course / fees / join — sab ka ek hi jawab ----
  {
    keywords: [
      "enroll", "enrol", "join", "registration", "register", "admission",
      "shamil", "dakhla", "course", "class lena", "seekhna", "sikhna", "training",
      "fees", "fee", "price", "qeemat", "kitni fees", "batch", "kab shuru",
      "start", "starting", "next batch", "admission open"
    ],
    reply:
      "Support Program ka naya batch *1 September* ko shuru hoga.\n\n" +
      "Registration khulne par team aap ko itlaa kar degi. Shukriya!",
  },

  // ---- Timings ----
  {
    keywords: ["timing", "time", "waqt", "kab class", "class time", "schedule", "kitne baje"],
    reply:
      "Support group ka time: *subha 8 baje se 2 baje tak*\n" +
      "Recorded classes: *4 baje tak* upload ho jati hain\n\n" +
      "Classes recorded hain — apni marzi se jab chahein dekh sakte hain.",
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

// Pehle sawal ke jawab ke baad ye doosra sawal khud ba khud jata hai
export const SURVEY_MESSAGE_2 =
  "Aakhri sawal — hamari team ka behaviour kaisa laga?\n\n" +
  "1 = Bohot achha\n" +
  "2 = Theek tha\n" +
  "3 = Achha nahi\n\n" +
  "Sirf number likh kar bhej dein.";

// Pehla sawal: "1" (masla hal ho gaya)
export const SURVEY_REPLY_YES =
  "Shukriya!";

// Pehla sawal: "2" (masla hal nahi hua)
export const SURVEY_REPLY_NO =
  "Maazrat. Hamari team dobara aap se rabta karegi.";

// Doosre sawal ke baad — sab ke liye ek hi
export const SURVEY_REPLY_DONE =
  "Aap ka waqt dene ka shukriya!\n\n" +
  "Koi aur sawal ho to kabhi bhi message karein.";

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
//  OFF TIME (kaam ke auqat) — sab waqt Pakistan ka hai
// ============================================================

// Rozana kaam ka waqt: subha 8 se raat 11 tak
export const WORK_START_HOUR = 8;    // subha 8 baje
export const WORK_END_HOUR = 23;     // raat 11 baje

// Weekend off: Jumeraat shaam 4 baje se Hafta subha 8 baje tak
// (0 = Itwar, 1 = Peer, 2 = Mangal, 3 = Budh, 4 = Jumeraat, 5 = Jumma, 6 = Hafta)
export const WEEKEND_START_DAY = 4;    // Jumeraat
export const WEEKEND_START_HOUR = 16;  // shaam 4 baje
export const WEEKEND_END_DAY = 6;      // Hafta
export const WEEKEND_END_HOUR = 8;     // subha 8 baje

// Weekend ke waqt jo message jayega
export const WEEKEND_MESSAGE =
  "Assalam o alaikum!\n\n" +
  "Abhi hamara *weekend off* chal raha hai.\n\n" +
  "Off time: *Jumeraat shaam 4 baje se Hafta subha 8 baje tak*\n\n" +
  "Aap ka message hamare paas mehfooz hai. Hafta subha 8 baje ke baad " +
  "team aap se rabta kar legi.\n\n" +
  "Shukriya!";

// Raat ke waqt (11 se 8) jo message jayega
export const NIGHT_MESSAGE =
  "Assalam o alaikum!\n\n" +
  "Abhi hamara working time nahi hai.\n\n" +
  "Working hours: *subha 8 baje se raat 11 baje tak* (Pakistan time)\n\n" +
  "Aap ka message hamare paas mehfooz hai. Subha team aap se rabta kar legi.\n\n" +
  "Shukriya!";

// Ek hi banday ko off-time ka message dobara bhejne se pehle itne minute ka wait
// (taake wo 10 message likhe to 10 baar wohi jawab na jaye)
export const OFFTIME_COOLDOWN_MINUTES = 120;

// ============================================================
//  DATA CLEANUP
//  Itne din baad purani chats khud delete ho jayengi
//  (30 din — stats mein 28 din ka poora hisab mil sake)
// ============================================================

export const MESSAGE_RETENTION_DAYS = 30;
