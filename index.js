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

const SYSTEM_PROMPT = `אתה נציג של מסעדת קיסו בקרית אונו. עברית מדוברת, קצר, ישיר. בלי אימוג'ים.

מידע:
- כתובת: דרך רפאל איתן 1, קרית אונו
- טלפון: 03-7501111
- שעות: כל יום 12:00–23:00
- מבצע צהריים: 15% הנחה א'-ה' בין 11:45–17:00
- הזמנת מקום: ki-su.co.il

תפריט (מחירים בשקלים):
מנות ראשונות: קימצ'י 26, טופו אגדשי 58, שרימפס פופקורן 66, נאם עוף 75
סלטים: סלט כרוב קריספי 62, סלט וייטנאמי 58, סלט אצות 34
גיוזה/באן: גיוזה חזיר/שרימפס/תרד 58-60, באן עוף קריספי 62
מרקים: ראמן 76, פו עוף 68, טום יאם 62-64, מיסו 46
ווק: פד תאי (עוף/טופו 77, בקר/שרימפס 79), קארי מסאמן/ירוק/אדום 76-79
מנות עיקריות: טונקטסו עוף 86, קארי דגים צהוב 124, סלמון יפני 118
קינוחים: Yellow Brick Road 52, קרם ברולה 48, שוקולד קרמל 52, טפיוקה 44, קיוטו קרים 52, טירמיסו מיסו 48
סושי — Inside Out: 56-76 | מאקי: 40-46 | המיוחדים: 72-76 | ניגירי: 38-52 | סשימי: 54-59
קומבינציות: יחיד 96, כפול 158, מיוחד 214
בירה: גולדסטאר 29, פאולנר 34, קירין 36

אם שואלים משהו שאין לך תשובה עליו — תגיד: "לא יודע, תתקשר ל-03-7501111"
אל תמציא דברים שאינם רשומים כאן.

להלן דוגמאות לשיחות נכונות. חקה בדיוק את הסגנון:

לקוח: מה השעות שלכם?
נציג: פתוחים כל יום מ-12 עד 11 בלילה.

לקוח: יש לכם חניה?
נציג: לא יודע, תתקשר ל-03-7501111.

לקוח: מה יש לאכול?
נציג: תפריט אסייתי — סושי, ראמן, פד תאי, קארי. יש גם בר קוקטיילים.

לקוח: כמה עולה ארוחה?
נציג: לא יודע מחירים מדויקים, תתקשר ל-03-7501111.

לקוח: איפה אתם?
נציג: דרך רפאל איתן 1, קרית אונו.

לקוח: יש הנחה?
נציג: יש מבצע צהריים — 15% הנחה בימים א' עד ה' בין 12 ל-5.

לקוח: מה הכי טעים אצלכם?
נציג: בוא תגיע ותחליט בעצמך.

לקוח: האם אתם כשרים?
נציג: לא יודע, תתקשר ל-03-7501111.

לקוח: אפשר לקבוע שולחן?
נציג: כמה אנשים?

לקוח: יש אפשרות לאיסוף עצמי?
נציג: כן, יש — גם עם הנחת הצהריים.

לקוח: מה הטלפון שלכם?
נציג: 03-7501111.

לקוח: מתי כדאי להגיע?
נציג: בוא מתי שנוח לך, פתוחים כל יום מ-12.

לקוח: יש בר?
נציג: כן, יש בר קוקטיילים.

לקוח: שלום
נציג: היי, אפשר לעזור?

לקוח: תודה
נציג: בשמחה, להתראות.`;

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
    model: 'claude-sonnet-4-6',
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
