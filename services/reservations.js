// Mock reservation store — replace with Google Sheets API when going live
// Google Sheets swap point: implement getAvailableSlots() and createReservation()
// using googleapis package with a service account key

const mockReservations = [];

const TIME_SLOTS = ['12:00', '13:00', '14:00', '15:00', '18:00', '19:00', '20:00', '21:00', '22:00'];
const MAX_PER_SLOT = 3; // max reservations per time slot per branch

export function getAvailableSlots(branchId, date) {
  const taken = mockReservations.filter(
    (r) => r.branchId === branchId && r.date === date
  );
  const takenBySlot = {};
  for (const r of taken) {
    takenBySlot[r.time] = (takenBySlot[r.time] || 0) + 1;
  }
  return TIME_SLOTS.filter((slot) => (takenBySlot[slot] || 0) < MAX_PER_SLOT);
}

export function createReservation({ branchId, date, time, partySize, name, phone }) {
  const reservation = {
    id: Date.now().toString(),
    branchId,
    date,
    time,
    partySize,
    name,
    phone,
    createdAt: new Date().toISOString(),
  };
  mockReservations.push(reservation);
  return reservation;
}

export function getReservationsByPhone(phone) {
  return mockReservations.filter((r) => r.phone === phone);
}
