import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { branches, DEFAULT_BRANCH } from './config/branches.js';
import { getAvailableSlots, createReservation } from './services/reservations.js';
import { initSheet, appendReservation } from './services/sheets.js';
import {
  isHostess,
  createHandoff,
  getHandoffByCustomer,
  resolveHandoff,
  clearHandoff,
  getHostessPhones,
  getTimedOutHandoffs,
  hasPendingHandoffs,
} from './services/handoff.js';

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

אם השאלה לא מכוסה במידע שיש לך — ענה בדיוק: "לא יודע"
אל תמציא דברים שאינם רשומים כאן.

להלן דוגמאות לשיחות נכונות. חקה בדיוק את הסגנון:

לקוח: מה השעות שלכם?
נציג: פתוחים כל יום מ-12 עד 11 בלילה.

לקוח: יש לכם חניה?
נציג: לא יודע

לקוח: מה יש לאכול?
נציג: תפריט אסייתי — סושי, ראמן, פד תאי, קארי. יש גם בר קוקטיילים.

לקוח: כמה עולה ראמן?
נציג: ראמן עולה 76 שקל.

לקוח: מה יש לקינוח?
נציג: יש קרם ברולה, שוקולד קרמל, טפיוקה, קיוטו קרים, טירמיסו מיסו, ו-Yellow Brick Road. בין 44 ל-52 שקל.

לקוח: איפה אתם?
נציג: דרך רפאל איתן 1, קרית אונו.

לקוח: יש הנחה?
נציג: יש מבצע צהריים — 15% הנחה בימים א' עד ה' בין 12 ל-17.

לקוח: מה הכי טעים אצלכם?
נציג: בוא תגיע ותחליט בעצמך.

לקוח: האם אתם כשרים?
נציג: לא יודע

לקוח: אפשר לקבוע שולחן?
נציג: כמה אנשים?

לקוח: מה הטלפון שלכם?
נציג: 03-7501111.

לקוח: שלום
נציג: היי, אפשר לעזור?

לקוח: תודה
נציג: בשמחה, להתראות.`;

const conversations = new Map();

function getUser(phone) {
  if (!conversations.has(phone)) {
    conversations.set(phone, { messages: [], reservation: null, frozen: false });
  }
  return conversations.get(phone);
}

// ── Reservation flow ──────────────────────────────────────────────────────────

async function handleReservation(from, text, user) {
  const branch = branches[DEFAULT_BRANCH];
  const state = user.reservation;

  if (!state || state.step === 'done') {
    user.reservation = { step: 'party_size', branchId: DEFAULT_BRANCH, data: {} };
    return 'כמה אנשים?';
  }

  if (state.step === 'party_size') {
    const n = parseInt(text);
    if (!n || n < 1 || n > branch.maxPartySize) return `כמה אנשים? (1 עד ${branch.maxPartySize})`;
    state.data.partySize = n;
    state.step = 'date';
    return 'איזה תאריך? (למשל: 25/04)';
  }

  if (state.step === 'date') {
    const match = text.match(/(\d{1,2})[\/\-\.](\d{1,2})/);
    if (!match) return 'איזה תאריך? (למשל: 25/04)';
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    state.data.date = `${day}/${month}/${new Date().getFullYear()}`;
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
      appendReservation({ ...state.data, branchId: state.branchId, phone: from }).catch(e => console.error('Sheets error:', e.message));
      state.step = 'done';
      const { date, time, partySize, name } = state.data;
      return `מעולה, שמרנו לך מקום.\n${name}, ${partySize} איש, ${date} בשעה ${time}.\nמחכים לך!`;
    }
    user.reservation = null;
    return 'ביטלתי. אם תרצה להזמין שוב — רק תגיד.';
  }

  return 'משהו השתבש. רוצה להתחיל מחדש?';
}

function isReservationIntent(text) {
  const keywords = ['להזמין', 'הזמנה', 'שולחן', 'מקום פנוי', 'לשמור מקום', 'רוצה לבוא', 'רוצים לבוא', 'לקבוע', 'reservation'];
  return keywords.some((k) => text.includes(k));
}

// ── Claude FAQ ────────────────────────────────────────────────────────────────

async function askClaude(user, userMessage) {
  user.messages.push({ role: 'user', content: userMessage });
  const trimmed = user.messages.slice(-10);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: trimmed,
  });

  const reply = response.content[0].text.trim();
  user.messages.push({ role: 'assistant', content: reply });
  return reply;
}

// ── Handoff ───────────────────────────────────────────────────────────────────

async function notifyHostess(customerPhone, question) {
  const hostesses = getHostessPhones();
  const msg = `שאלה מלקוח (${customerPhone.slice(-4)}):\n"${question}"\n\nענה כאן ואני אעביר ללקוח.\nכשסיימת — שלח ✅`;
  for (const h of hostesses) {
    await sendMessage(h, msg);
  }
}

// ── Main message router ───────────────────────────────────────────────────────

async function handleMessage(from, text) {
  // hostess reply — only if there's an active handoff pending
  if (isHostess(from) && hasPendingHandoffs()) {
    if (text.trim() === '✅') {
      return null;
    }
    const resolved = resolveHandoff(text);
    if (resolved) {
      const user = getUser(resolved.customerPhone);
      user.frozen = false;
      await sendMessage(resolved.customerPhone, resolved.answer);
    }
    return null;
  }

  const user = getUser(from);

  // frozen conversation — customer sent another message while waiting
  if (user.frozen) {
    return 'עוד רגע, המארחת בודקת לך.';
  }

  // active reservation flow
  if (user.reservation && user.reservation.step !== 'done') {
    return await handleReservation(from, text, user);
  }

  // reservation intent
  if (isReservationIntent(text)) {
    return await handleReservation(from, text, user);
  }

  // FAQ via Claude
  const reply = await askClaude(user, text);

  // if Claude doesn't know → handoff
  if (reply.trim() === 'לא יודע' || reply.startsWith('לא יודע')) {
    user.frozen = true;
    createHandoff(from, text);
    await notifyHostess(from, text);
    return 'רגע, בודקת לך. כמה דקות.';
  }

  return reply;
}

// ── WhatsApp API ──────────────────────────────────────────────────────────────

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

// ── Timeout check (every minute) ─────────────────────────────────────────────

setInterval(async () => {
  const timedOut = getTimedOutHandoffs();
  for (const customerPhone of timedOut) {
    const user = getUser(customerPhone);
    user.frozen = false;
    await sendMessage(customerPhone, 'סליחה על ההמתנה. לתשובה מהירה תתקשר ל-03-7501111.');
  }
}, 60_000);

// ── Express routes ────────────────────────────────────────────────────────────

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
    if (reply) {
      console.log(`[BOT → ${from}] ${reply}`);
      await sendMessage(from, reply);
    }
  } catch (err) {
    console.error('Error:', err.message);
    await sendMessage(from, 'סליחה, נתקלתי בתקלה. נסה שוב בעוד רגע.');
  }
});

app.get('/health', (_, res) => res.send('OK'));

app.listen(process.env.PORT || 3000, async () => {
  console.log('Bot server running');
  await initSheet().catch(e => console.error('Sheet init error:', e.message));
});
