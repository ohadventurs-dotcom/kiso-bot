import express from 'express';
import Anthropic from '@anthropic-ai/sdk';

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `אתה נציג של מסעדת קיסו בקרית אונו. אתה כותב כמו בן אדם רגיל בווטסאפ — קצר, ישיר, חברותי. עברית מדוברת לגמרי.

דוגמאות לסגנון נכון:
- "פתוחים כל יום מ-12 עד 11 בלילה"
- "יש סושי, ראמן, פד תאי ועוד — תפריט אסייתי מגוון"
- "לא יודע בדיוק, תתקשר אלינו ב-03-7501111 ויסדרו אותך"
- "בסופ״ש כדאי להזמין יום לפני, ביום רגיל אפשר גם ביום עצמו"

דוגמאות לסגנון שאסור:
- "בשמחה רבה אוכל לספר לך..." — יותר מדי פורמלי
- "לא יודע בדיוק את המנהל שלנו" — זה לא מובן בכלל
- "תקשר" במקום "תתקשר"
- משפטים עם מילים כמו "מומלץ", "בדרך כלל", "ניתן" — דבר ישיר

מידע על המסעדה:
- כתובת: דרך רפאל איתן 1, קרית אונו
- טלפון: 03-7501111
- שעות: כל יום 12:00–23:00
- הזמנת מקום: ki-su.co.il
- מבצע צהריים: 15% הנחה א'-ה' בין 11:45–17:00 (ישיבה או איסוף עצמי)
- תפריט: סושי (רולים, מאקי, ניגירי, סשימי), ווק, ראמן, פד תאי, קארי, מנות ראשונות, בר קוקטיילים

כללים:
- תשובה קצרה — 1-2 משפטים מקסימום
- אם השאלה לא מכוסה במידע שיש לך — תגיד רק: "לא יודע בדיוק, תתקשר אלינו ב-03-7501111" ותפסיק. אל תוסיף ניחושים.
- אל תמציא מדיניות, הנחיות, או עצות שלא כתובות כאן במפורש
- אין אמוג'ים`;

// conversation history per user (in-memory)
const conversations = new Map();

async function askClaude(userPhone, userMessage) {
  if (!conversations.has(userPhone)) {
    conversations.set(userPhone, []);
  }

  const history = conversations.get(userPhone);
  history.push({ role: 'user', content: userMessage });

  // keep last 10 messages to avoid token bloat
  const trimmed = history.slice(-10);

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: trimmed,
  });

  const reply = response.content[0].text;
  history.push({ role: 'assistant', content: reply });

  return reply;
}

async function sendMessage(to, text) {
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) console.error('Send error:', JSON.stringify(data));
  return data;
}

// Meta webhook verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Incoming messages
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // respond to Meta immediately

  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message || message.type !== 'text') return;

  const from = message.from;
  const text = message.text.body;
  console.log(`[${from}] ${text}`);

  try {
    const reply = await askClaude(from, text);
    console.log(`[BOT → ${from}] ${reply}`);
    await sendMessage(from, reply);
  } catch (err) {
    console.error('Claude error:', err.message);
    await sendMessage(from, 'סליחה, נתקלתי בתקלה טכנית. נסה שוב בעוד רגע.');
  }
});

app.get('/health', (_, res) => res.send('OK'));

app.listen(process.env.PORT || 3000, () => {
  console.log('Bot server running');
});
