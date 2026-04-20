// Human handoff state machine
// When bot can't answer → freezes conversation → notifies hostess → forwards reply to customer

const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// Map of customerPhone → { question, timestamp, hostessPhone }
const pendingHandoffs = new Map();

export function getHostessPhones() {
  return (process.env.HOSTESS_PHONE || '').split(',').map((p) => p.trim()).filter(Boolean);
}

export function isHostess(phone) {
  return getHostessPhones().includes(phone);
}

export function createHandoff(customerPhone, question) {
  pendingHandoffs.set(customerPhone, {
    question,
    timestamp: Date.now(),
    notified: false,
  });
}

export function getHandoffByCustomer(customerPhone) {
  return pendingHandoffs.get(customerPhone) || null;
}

// When hostess replies — find which customer they're handling
// Simple: return the oldest pending handoff (one hostess, one queue)
export function resolveHandoff(hostessReply) {
  if (pendingHandoffs.size === 0) return null;

  // get oldest pending
  let oldest = null;
  let oldestPhone = null;
  for (const [phone, handoff] of pendingHandoffs) {
    if (!oldest || handoff.timestamp < oldest.timestamp) {
      oldest = handoff;
      oldestPhone = phone;
    }
  }

  if (!oldestPhone) return null;
  pendingHandoffs.delete(oldestPhone);
  return { customerPhone: oldestPhone, answer: hostessReply };
}

export function clearHandoff(customerPhone) {
  pendingHandoffs.delete(customerPhone);
}

// Check for timed-out handoffs — returns list of customerPhones that timed out
export function hasPendingHandoffs() {
  return pendingHandoffs.size > 0;
}

export function getTimedOutHandoffs() {
  const timedOut = [];
  const now = Date.now();
  for (const [phone, handoff] of pendingHandoffs) {
    if (now - handoff.timestamp > TIMEOUT_MS) {
      timedOut.push(phone);
      pendingHandoffs.delete(phone);
    }
  }
  return timedOut;
}
