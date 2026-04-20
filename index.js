import express from 'express';
import Anthropic from '@anthropic-ai/sdk';

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `אתה נציג שירות לקוחות של מסעדת קיסו בקרית אונו. אתה עונה בעברית, בגובה העיניים, בקצרה ובחביבות.

מידע על המסעדה:
- שם: קיסו (KISU) — מסעדה אסייתית מודרנית
- כתובת: דרך רפאל איתן 1, קרית אונו
- טלפון: 03-7501111
- שעות פתיחה: כל יום 12:00–23:00
- הזמנת מקום: דרך האתר ki-su.co.il או טאביט
- מבצע צהריים: 15% הנחה ימים א'-ה' בין 11:45–17:00 (ישיבה במסעדה או איסוף עצמי)

תפריט עיקרי:
- סושי: מגוון רולים, מאקי, ניגירי, סשימי, inside out
- ווק ומנות חמות: פד תאי (עוף/שרימפס/טופו), ראמן, קארי, סטייק נוד-טוק
- מנות ראשונות ומשתפות
- בר קוקטיילים

כללים:
- אם שואלים על הזמנת מקום — שלח לאתר ki-su.co.il או הצע לחזור אליהם בטלפון
- אם אתה לא יודע תשובה מדויקת — הגד שתוכל לבדוק ותחזור, אל תמציא
- תשובות קצרות — מקסימום 3 משפטים
- אל תשתמש באימוג'ים מוגזמים`;

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
