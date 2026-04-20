import express from 'express';

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

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
  const body = req.body;

  if (body.object === 'whatsapp_business_account') {
    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (message?.type === 'text') {
      const from = message.from;
      const text = message.text.body;
      console.log(`Message from ${from}: ${text}`);

      console.log(`Sending reply to ${from}...`);
      const result = await sendMessage(from, `קיבלתי: "${text}" — הבוט של קיסו בקרוב כאן 🍽️`);
      console.log(`Reply result: ${JSON.stringify(result)}`);
    } else {
      console.log(`Non-text event: ${message?.type || 'no message'}`);
    }
  }

  res.sendStatus(200);
});

app.get('/health', (_, res) => res.send('OK'));

app.listen(process.env.PORT || 3000, () => {
  console.log('Bot server running');
});
