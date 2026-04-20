import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { branches, DEFAULT_BRANCH } from './config/branches.js';
import { getAvailableSlots, createReservation } from './services/reservations.js';

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
- "לא יודע בדיוק, תתקשר אלינו ל-03-7501111 ויסדרו אותך"
- "בוא תגיע ותחליט בעצמך"

דוגמאות לסגנון שאסור:
- "בשמחה רבה אוכל לספר לך..." — יותר מדי פורמלי
- "בואנו" — לא מילה בעברית
- "תקשר" במקום "תתקשר"
- משפטים עם מילים כמו "מומלץ", "ניתן", "בדרך כלל" — דבר ישיר
- אין אימוג'ים בשום מצב — אפס, אפילו לא 🍣 או 😊

מידע על המסעדה:
- כתובת: דרך רפאל איתן 1, קרית אונו
- טלפון: 03-7501111
- שעות: כל יום 12:00–23:00
- מבצע צהריים: 15% הנחה א'-ה' בין 11:45–17:00 (ישיבה או איסוף עצמי)
- תפריט: סושי (רולים, מאקי, ניגירי, סשימי), ווק, ראמן, פד תאי, קארי, מנות ראשונות, בר קוקטיילים

כללים:
- תשובה קצרה — 1-2 משפטים מקסימום
- אם השאלה לא מכוסה במידע שיש לך — תגיד: "לא יודע בדיוק, תתקשר אלינו ל-03-7501111" ותפסיק
- אל תמציא מדיניות, עובדות, או עצות שלא כתובות כאן
- שאלות סובייקטיביות (הכי רומנטי, הכי טעים) — ענה: "בוא תגיע ותחליט בעצמך"
- אין אמוג'ים בכלל`;

// per-user state
const conversations = new Map(); // { messages: [], reservation: null }

function getUser(phone) {
  if (!conversations.has(phone)) {
    conversations.set(phone, { messages: [], reservation: null });
  }
  return conversations.get(phone);
}

// reservation flow state machine
// steps: null → party_size → date → time → name → confirm → done
async function handleReservation(from, text, user) {
  const branch = branches[DEFAULT_BRANCH];
  const state = user.reservation;

  if (!state || state.step === 'done') {
    // start reservation flow
    user.reservation = { step: 'party_size', branchId: DEFAULT_BRANCH, data: {} };
    return 'כמה אנשים?';
  }

  if (state.step === 'party_size') {
    const n = parseInt(text);
    if (!n || n < 1 || n > branch.maxPartySize) {
      return `כמה אנשים? (1 עד ${branch.maxPartySize})`;
    }
    state.data.partySize = n;
    state.step = 'date';
    return 'איזה תאריך? (למשל: 25/04)';
  }

  if (state.step === 'date') {
    const match = text.match(/(\d{1,2})[\/\-\.](\d{1,2})/);
    if (!match) return 'איזה תאריך? (למשל: 25/04)';
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    const year = new Date().getFullYear();
    state.data.date = `${day}/${month}/${year}`;
    state.step = 'time';
    const available = getAvailableSlots(state.branchId, state.data.date);
    if (available.length === 0) {
      state.step = 'date';
      return `אין מקום ב-${state.data.date}. נסה תאריך אחר.`;
    }
    return `איזה שעה? השעות הפנויות: ${available.join(', ')}`;
  }

  if (state.step === 'time') {
    const available = getAvailableSlots(state.branchId, state.data.date);
    const match = available.find((s) => text.includes(s.replace(':00', '')) || text.includes(s));
    if (!match) return `בחר שעה מהרשימה: ${available.join(', ')}`;
    state.data.time = match;
    state.step = 'name';
    return 'על שם מי לשמור?';
  }

  if (state.step === 'name') {
    state.data.name = text.trim();
    state.step = 'confirm';
    const { date, time, partySize, name } = state.data;
    return `לאשר?\n${name}, ${partySize} איש, ${date} בשעה ${time} בקיסו קרית אונו\nשלח "כן" לאישור או "לא" לביטול`;
  }

  if (state.step === 'confirm') {
    if (text.includes('כן') || text.includes('אישור')) {
      createReservation({ ...state.data, branchId: state.branchId, phone: from });
      state.step = 'done';
      const { date, time, partySize, name } = state.data;
      return `מעולה, שמרנו לך מקום.\n${name}, ${partySize} איש, ${date} בשעה ${time}.\nמחכים לך!`;
    } else {
      user.reservation = null;
      return 'ביטלתי. אם תרצה להזמין שוב — רק תגיד.';
    }
  }

  return 'משהו השתבש. רוצה להתחיל מחדש?';
}

function isReservationIntent(text) {
  const keywords = ['להזמין', 'הזמנה', 'שולחן', 'מקום פנוי', 'לשמור מקום', 'רוצה לבוא', 'רוצים לבוא', 'לקבוע', 'reservation'];
  return keywords.some((k) => text.includes(k));
}

async function askClaude(user, userMessage) {
  user.messages.push({ role: 'user', content: userMessage });
  const trimmed = user.messages.slice(-10);

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: trimmed,
  });

  const reply = response.content[0].text;
  user.messages.push({ role: 'assistant', content: reply });
  return reply;
}

async function handleMessage(from, text) {
  const user = getUser(from);
  const lower = text.toLowerCase();

  // active reservation flow takes priority
  if (user.reservation && user.reservation.step !== 'done') {
    return await handleReservation(from, text, user);
  }

  // detect reservation intent
  if (isReservationIntent(lower)) {
    return await handleReservation(from, text, user);
  }

  // FAQ via Claude
  return await askClaude(user, text);
}

async function sendMessage(to, text) {
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
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

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message || message.type !== 'text') return;

  const from = message.from;
  const text = message.text.body;
  console.log(`[${from}] ${text}`);

  try {
    const reply = await handleMessage(from, text);
    console.log(`[BOT → ${from}] ${reply}`);
    await sendMessage(from, reply);
  } catch (err) {
    console.error('Error:', err.message);
    await sendMessage(from, 'סליחה, נתקלתי בתקלה. נסה שוב בעוד רגע.');
  }
});

app.get('/health', (_, res) => res.send('OK'));

app.listen(process.env.PORT || 3000, () => console.log('Bot server running'));
