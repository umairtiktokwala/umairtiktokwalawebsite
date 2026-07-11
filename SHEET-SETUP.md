# Prompt Book — Google Sheet Setup

## 1. Sheet banao

Google Sheets pe nayi sheet banao. **Row 1 mein ye exact headings** daalo, isi order mein:

| A | B | C | D | E |
|---|---|---|---|---|
| Image URL | Title | Prompt | Category | Tool |

**Column ka matlab:**

- **Image URL** — image ka direct link (Cloudinary se)
- **Title** — chhota naam, e.g. "Village night scene"
- **Prompt** — poora master prompt. Lamba ho sakta hai, comma bhi chalega, multi-line bhi.
- **Category** — filter chips isi se bante hain, e.g. `3D Drama`, `Photorealistic`, `Horror`
- **Tool** — e.g. `Seedance`, `Midjourney`, `Artlist`

**Category aur Tool khaali chhod sakte ho** — sirf Prompt zaroori hai.

---

## 2. Sheet ko publish karo

Sheet mein jao:

```
File  →  Share  →  Publish to web
        Entire document  →  Comma-separated values (.csv)
        Publish  →  OK
```

Ye zaroori hai. Bina publish kiye website sheet ko parh nahi sakti.

---

## 3. Sheet ID nikaalo

Sheet ka URL aisa dikhta hai:

```
https://docs.google.com/spreadsheets/d/1AbC2dEfGhIjK3lMnOpQrStUvWxYz/edit
                                       └────────── YE HAI ID ──────────┘
```

Beech wala lamba code copy karo.

---

## 4. index.html mein daalo

`index.html` kholo, neeche `<script>` mein ye line dhoondo:

```js
const SHEET_ID  = 'PASTE_SHEET_ID_HERE';
```

`PASTE_SHEET_ID_HERE` ko apni ID se replace kar do:

```js
const SHEET_ID  = '1AbC2dEfGhIjK3lMnOpQrStUvWxYz';
```

Bas. Ab site sheet se prompts uthayegi.

---

## Roz ka kaam (2 minute)

1. **Cloudinary** pe image upload → link copy
2. **Sheet mein nayi row** → link, title, prompt, category, tool
3. **Ho gaya** — site pe khud aa jayega

Website update karne ki zaroorat nahi. Sheet hi content hai.

---

## Images kahan rakhni hain

**Cloudinary** — free account bana lo (25 GB free).

- Upload karo
- "Copy URL" dabao
- Wo URL sheet mein paste

**Google Drive mat use karna.** Wo image hosting ke liye bana hi nahi — slow hai aur images randomly load hona band ho jati hain.

---

## Notes

- **Sabse nayi row site pe sabse upar** aayegi
- Category se **filter chips** khud ban jate hain — nayi category likho, naya chip aa jayega
- Ek page pe **9 prompts**, phir "Show more"
- **Copy prompt** button — click pe poora prompt clipboard mein
