import { ENDPOINT } from './config.js';

// Empty ENDPOINT runs the page in demo mode. Records then stay in this browser only.
export const DEMO = !ENDPOINT;

const NETWORK = { ok: false, code: 'NETWORK', message: 'Cannot reach the log. Check your connection and try again.' };

// ---- Remote: Apps Script web app -------------------------------------------
async function remoteGet(action) {
  try {
    const res = await fetch(`${ENDPOINT}?action=${encodeURIComponent(action)}`, { redirect: 'follow' });
    if (!res.ok) return NETWORK;
    return await res.json();
  } catch {
    return NETWORK;
  }
}

// text/plain keeps the request "simple", so the browser sends no CORS preflight.
async function remotePost(body) {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
    });
    if (!res.ok) return NETWORK;
    return await res.json();
  } catch {
    return NETWORK;
  }
}

// ---- Demo store (same answers as apps-script/Code.gs) ----------------------
const KEY = 'share-eq-demo-v1';
const SAMPLE = [
  ['EQ-001', 'Laptop (Lenovo ThinkPad)', 'IT'],
  ['EQ-002', 'LCD projector', 'IT'],
  ['EQ-003', 'Portable speaker with microphone', 'AV'],
  ['EQ-004', 'Extension cord (5 m)', 'Accessories'],
  ['EQ-005', 'Digital camera', 'AV'],
  ['EQ-006', 'Cooler box (organ transport)', 'Clinical'],
  ['EQ-007', 'Tablet (iPad)', 'IT'],
  ['EQ-008', 'Tarpaulin stand', 'Events'],
];

export function manilaToday(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(d);
}
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const norm = (s) => String(s ?? '').trim().toLowerCase();

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || { loans: [] };
  } catch {
    return { loans: [] };
  }
}
function save(db) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch { /* Private mode: the demo still answers for this visit. */ }
}

const open = (db, email, today) => db.loans
  .filter((l) => l.status === 'OUT' && l.email === email)
  .map((l) => ({ loanId: l.loanId, itemName: l.itemName, borrowedAt: l.borrowedAt, dueDate: l.dueDate, overdue: daysBetween(l.dueDate, today) >= 1 }));

const demo = {
  catalog() {
    const out = new Set(load().loans.filter((l) => l.status === 'OUT').map((l) => l.itemId));
    return { ok: true, today: manilaToday(), items: SAMPLE.map(([id, name, category]) => ({ id, name, category, available: !out.has(id) })) };
  },
  borrow(req) {
    const db = load();
    const today = manilaToday();
    const email = norm(req.email);
    const out = new Set(db.loans.filter((l) => l.status === 'OUT').map((l) => l.itemId));
    const taken = req.itemIds.filter((id) => out.has(id));
    if (taken.length) {
      const names = taken.map((id) => SAMPLE.find((s) => s[0] === id)[1]);
      return { ok: false, code: 'ITEM_OUT', itemIds: taken, message: `${names.join(', ')} is already borrowed.` };
    }
    const batch = `EQ${today.slice(2).replace(/-/g, '')}-DEMO${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    const loans = req.itemIds.map((id, i) => {
      const name = SAMPLE.find((s) => s[0] === id)[1];
      const loan = { loanId: `${batch}-${i + 1}`, itemId: id, itemName: name, email, borrowedAt: today, dueDate: req.dueDate, status: 'OUT' };
      db.loans.push(loan);
      return { loanId: loan.loanId, itemName: name };
    });
    save(db);
    return { ok: true, loans, dueDate: req.dueDate, email };
  },
  lookup(req) {
    return { ok: true, loans: open(load(), norm(req.email), manilaToday()) };
  },
  return(req) {
    const db = load();
    const email = norm(req.email);
    const returned = [];
    const already = [];
    req.loanIds.forEach((id) => {
      const l = db.loans.find((x) => x.loanId === id && x.email === email);
      if (!l) return;
      if (l.status !== 'OUT') { already.push(l.itemName); return; }
      l.status = 'RETURNED';
      l.condition = req.condition;
      returned.push(l.itemName);
    });
    save(db);
    if (!returned.length && !already.length) return { ok: false, code: 'NOT_FOUND', message: 'No open loan matches this email.' };
    return { ok: true, returned, already, missing: [], stillOut: open(db, email, manilaToday()) };
  },
};

const wait = () => new Promise((r) => setTimeout(r, 350));

export async function catalog() {
  if (DEMO) { await wait(); return demo.catalog(); }
  return remoteGet('catalog');
}

export async function send(action, payload) {
  if (DEMO) { await wait(); return demo[action](payload); }
  return remotePost({ action, ...payload });
}
