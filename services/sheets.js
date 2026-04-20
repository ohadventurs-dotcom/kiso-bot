import { google } from 'googleapis';

const OWNER_EMAIL = 'ohadventurs@gmail.com';
const SHEET_TITLE = 'הזמנות קיסו';

let sheetsClient = null;
let spreadsheetId = null;

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_B64
    ? Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8')
    : process.env.GOOGLE_SERVICE_ACCOUNT;
  const creds = JSON.parse(raw);
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });
}

async function getSheets() {
  if (!sheetsClient) {
    const auth = getAuth();
    sheetsClient = google.sheets({ version: 'v4', auth });
  }
  return sheetsClient;
}

async function getDrive() {
  const auth = getAuth();
  return google.drive({ version: 'v3', auth });
}

export async function initSheet() {
  if (!process.env.SHEET_ID) {
    console.error('SHEET_ID env var not set — reservations will not be saved to Sheets');
    return;
  }
  spreadsheetId = process.env.SHEET_ID;

  // ensure header row exists
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'A1:G1',
  });

  if (!res.data.values || res.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'A1:G1',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [['תאריך', 'שעה', 'שם', 'טלפון', 'מספר סועדים', 'סניף', 'נוצר ב']],
      },
    });
  }

  console.log(`Sheet ready: ${spreadsheetId}`);
}

export async function appendReservation({ date, time, name, phone, partySize, branchId }) {
  if (!spreadsheetId) {
    console.error('Sheet not initialized');
    return;
  }
  const sheets = await getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'הזמנות!A:G',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[date, time, name, phone, partySize, branchId, new Date().toLocaleString('he-IL')]],
    },
  });
}
