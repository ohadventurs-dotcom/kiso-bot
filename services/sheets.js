import { google } from 'googleapis';

const OWNER_EMAIL = 'ohadventurs@gmail.com';
const SHEET_TITLE = 'הזמנות קיסו';

let sheetsClient = null;
let spreadsheetId = null;

function getAuth() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
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
  if (process.env.SHEET_ID) {
    spreadsheetId = process.env.SHEET_ID;
    console.log(`Using existing sheet: ${spreadsheetId}`);
    return;
  }

  const sheets = await getSheets();

  // create new spreadsheet
  const res = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: SHEET_TITLE },
      sheets: [{
        properties: { title: 'הזמנות' },
        data: [{
          startRow: 0,
          startColumn: 0,
          rowData: [{
            values: ['תאריך', 'שעה', 'שם', 'טלפון', 'מספר סועדים', 'סניף', 'נוצר ב'].map(v => ({
              userEnteredValue: { stringValue: v },
              userEnteredFormat: { textFormat: { bold: true } },
            })),
          }],
        }],
      }],
    },
  });

  spreadsheetId = res.data.spreadsheetId;
  console.log(`Created sheet: ${spreadsheetId}`);

  // share with owner
  const drive = await getDrive();
  await drive.permissions.create({
    fileId: spreadsheetId,
    requestBody: { type: 'user', role: 'writer', emailAddress: OWNER_EMAIL },
    sendNotificationEmail: false,
  });

  console.log(`Sheet shared with ${OWNER_EMAIL}`);
  console.log(`Set SHEET_ID=${spreadsheetId} in Railway to persist across restarts`);
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
