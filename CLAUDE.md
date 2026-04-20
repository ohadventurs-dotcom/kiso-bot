# kiso-bot

WhatsApp chatbot למסעדות קיסוגרופ. עונה על שאלות ומנהל הזמנות שולחן.

## Stack
- Node.js + Express
- `@anthropic-ai/sdk` — claude-sonnet-4-6
- Railway (deploy)
- WhatsApp webhook

## קבצים מרכזיים
- `index.js` — לוגיקה ראשית, webhook handler, Claude API calls
- `config/branches.js` — מידע סניפים
- `services/reservations.js` — State machine להזמנות

## חשוב לזכור
- System prompt נשלח עם **כל** הודעה — חובה להוסיף `cache_control: ephemeral`
- State machine להזמנות עוקף Claude לחלוטין (לא לשבור)
- שומר 10 הודעות אחרונות בזיכרון per user

## Deploy
```bash
railway up
```
