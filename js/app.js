import { DEMO, catalog, send, manilaToday } from './api.js';
import { ENDPOINT } from './config.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  kids.flat().forEach((k) => k != null && n.append(k));
  return n;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9][0-9 -]{6,18}$/;
const MAX_DAYS = 90;
const MAX_ITEMS = 10;

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const prettyDate = (iso) => {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso || '')) return iso || '';
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-PH', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};

// The Apps Script backend takes 2 to 4 seconds per request, so a busy button shows a spinner and a message.
function busy(btn, on, label) {
  if (on) {
    btn.dataset.label = btn.textContent;
    btn.replaceChildren(el('span', { class: 'spin', 'aria-hidden': 'true' }), label);
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
  } else {
    btn.textContent = btn.dataset.label || btn.textContent;
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}

function showResult(box, ...nodes) {
  box.replaceChildren(...nodes);
  box.hidden = false;
  box.focus({ preventScroll: true });
  box.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
}

// ---- Catalog and status ----------------------------------------------------
let items = [];
let today = manilaToday();

function renderStatus() {
  const out = items.filter((i) => !i.available).length;
  $('[data-stat="available"]').textContent = String(items.length - out);
  $('[data-stat="out"]').textContent = String(out);
  $('[data-stat="today"]').textContent = prettyDate(today);
}

function renderItems() {
  const list = $('[data-items]');
  const q = $('#b-search').value.trim().toLowerCase();
  const picked = new Set($$('input[name="item"]:checked', list).map((i) => i.value));
  const shown = items.filter((i) => !q || `${i.name} ${i.id} ${i.category}`.toLowerCase().includes(q));
  list.setAttribute('aria-busy', 'false');
  if (!items.length) {
    list.replaceChildren(el('p', { class: 'muted', text: 'No equipment is listed yet. Ask the SHARE office.' }));
    return;
  }
  if (!shown.length) {
    list.replaceChildren(el('p', { class: 'muted', text: `No equipment matches "${q}".` }));
    return;
  }
  const groups = {};
  shown.forEach((i) => (groups[i.category || 'Other'] ||= []).push(i));
  const nodes = [];
  Object.keys(groups).sort().forEach((cat) => {
    nodes.push(el('p', { class: 'picker__group', text: cat }));
    groups[cat].forEach((i) => {
      const box = el('input', { type: 'checkbox', name: 'item', value: i.id, disabled: !i.available, checked: picked.has(i.id) && i.available });
      nodes.push(el('label', { class: `item${i.available ? '' : ' is-out'}` }, box,
        el('span', {}, el('span', { class: 'item__name', text: i.name }), el('span', { class: 'item__id', text: i.id })),
        i.available ? null : el('span', { class: 'badge badge--out', text: 'Out' })));
    });
  });
  // Keep a hidden checked item selected while the search hides it.
  picked.forEach((id) => {
    if (!shown.some((i) => i.id === id) && items.some((i) => i.id === id && i.available)) {
      nodes.push(el('input', { type: 'checkbox', name: 'item', value: id, checked: true, hidden: true }));
    }
  });
  list.replaceChildren(...nodes);
  updatePicked();
}

function updatePicked() {
  const n = $$('[data-items] input[name="item"]:checked').length;
  $('[data-picked]').textContent = `${n} selected`;
}

// The last equipment list is kept in this browser, so a return visit shows it at once.
// The server list replaces it when it arrives. The server still checks availability on every borrow.
const CACHE_KEY = `share-eq-catalog:${ENDPOINT || 'demo'}`;
let fromCache = false;

function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY));
    return c && Array.isArray(c.items) ? c : null;
  } catch {
    return null;
  }
}
function writeCache(list) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ items: list }));
  } catch { /* Private mode or full storage: the page works without the cache. */ }
}

function applyCatalog(list, serverToday) {
  // Re-rendering the list must not drop keyboard focus from a checkbox.
  const focused = document.activeElement?.closest?.('[data-items]') ? document.activeElement.value : null;
  items = list;
  today = serverToday || manilaToday();
  const due = $('#b-due');
  due.min = today;
  due.max = addDays(today, MAX_DAYS);
  renderStatus();
  renderItems();
  if (focused) $(`[data-items] input[value="${CSS.escape(focused)}"]`)?.focus();
}

async function loadCatalog() {
  const note = $('[data-sync]');
  if (fromCache) note.hidden = false;
  const res = await catalog();
  note.hidden = true;
  if (!res.ok) {
    if (fromCache) {
      note.textContent = 'Showing the saved list. The live list could not load.';
      note.hidden = false;
      return;
    }
    $('[data-items]').replaceChildren(el('p', { class: 'form__error', text: res.message }),
      el('button', { class: 'btn btn--ghost', type: 'button', 'data-retry': true, text: 'Try again' }));
    $('[data-retry]').addEventListener('click', loadCatalog);
    return;
  }
  fromCache = false;
  writeCache(res.items);
  applyCatalog(res.items, res.today);
}

// ---- Borrow ----------------------------------------------------------------
const bForm = $('#borrow-form');
const bError = $('[data-error]', bForm);
const bResult = $('[data-borrow-result]');

function borrowError(input, message) {
  bError.textContent = message;
  if (input) {
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  }
  return false;
}

function validateBorrow(data) {
  $$('[aria-invalid]', bForm).forEach((i) => i.removeAttribute('aria-invalid'));
  if (data.name.length < 2) return borrowError($('#b-name'), 'Enter your full name.');
  if (!EMAIL_RE.test(data.email)) return borrowError($('#b-email'), 'Enter a valid email address.');
  if (data.department.length < 2) return borrowError($('#b-dept'), 'Enter your department or unit.');
  if (!PHONE_RE.test(data.contact)) return borrowError($('#b-contact'), 'Enter a valid contact number, for example 0917 123 4567.');
  if (!data.itemIds.length) return borrowError($('#b-search'), 'Select at least one item.');
  if (data.itemIds.length > MAX_ITEMS) return borrowError(null, `Select ${MAX_ITEMS} items or fewer.`);
  if (!data.dueDate) return borrowError($('#b-due'), 'Select the return date.');
  if (data.dueDate < today) return borrowError($('#b-due'), 'The return date cannot be in the past.');
  if (data.dueDate > addDays(today, MAX_DAYS)) return borrowError($('#b-due'), `The return date must be within ${MAX_DAYS} days.`);
  bError.textContent = '';
  return true;
}

$('#b-email').addEventListener('input', (e) => {
  $('[data-email-echo]').textContent = e.target.value.trim().toLowerCase() || 'your email';
});
$('#b-search').addEventListener('input', renderItems);
$('[data-items]').addEventListener('change', updatePicked);

bForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(bForm);
  const data = {
    name: String(f.get('name') || '').replace(/\s+/g, ' ').trim(),
    email: String(f.get('email') || '').trim().toLowerCase(),
    department: String(f.get('department') || '').replace(/\s+/g, ' ').trim(),
    contact: String(f.get('contact') || '').trim(),
    itemIds: [...new Set(f.getAll('item').map(String))],
    dueDate: String(f.get('dueDate') || ''),
  };
  if (!validateBorrow(data)) return;
  const btn = $('button[type="submit"]', bForm);
  busy(btn, true, 'Saving to the log...');
  const res = await send('borrow', data);
  busy(btn, false);

  if (!res.ok) {
    bError.textContent = res.message || 'The log could not save this. Try again.';
    if (res.code === 'ITEM_OUT' || res.code === 'INVALID') await loadCatalog();
    return;
  }
  bForm.hidden = true;
  bForm.reset();
  $('[data-email-echo]').textContent = 'your email';
  const again = el('button', { class: 'btn btn--cyan', type: 'button', text: 'Borrow more equipment' });
  again.addEventListener('click', () => {
    bResult.hidden = true;
    bForm.hidden = false;
    $('#b-name').focus();
  });
  showResult(bResult,
    el('h3', { text: 'Equipment signed out' }),
    el('ul', {}, res.loans.map((l) => el('li', {}, el('strong', { text: l.itemName }), el('code', { text: l.loanId })))),
    el('p', {}, 'Bring it back by ', el('strong', { text: prettyDate(res.dueDate) }), '.'),
    el('p', { class: 'muted' }, 'After that date, a reminder goes to ', el('strong', { text: res.email }), ' every morning until you sign the items in.'),
    again);
  await loadCatalog();
});

// ---- Return ----------------------------------------------------------------
const lForm = $('#lookup-form');
const lError = $('[data-lookup-error]');
const rForm = $('#return-form');
const rError = $('[data-return-error]');
const rResult = $('[data-return-result]');
let lookupEmail = '';

function renderLoans(loans) {
  const box = $('[data-loans]');
  box.replaceChildren(...loans.map((l) => el('label', { class: 'item' },
    el('input', { type: 'checkbox', name: 'loan', value: l.loanId, checked: loans.length === 1 }),
    el('span', {},
      el('span', { class: 'item__name', text: l.itemName }),
      el('span', { class: 'item__id', text: `Borrowed ${prettyDate(l.borrowedAt)} · due ${prettyDate(l.dueDate)}` })),
    el('span', { class: `badge ${l.overdue ? 'badge--late' : 'badge--ok'}`, text: l.overdue ? 'Overdue' : 'On time' }))));
}

lForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#r-email');
  const email = input.value.trim().toLowerCase();
  input.removeAttribute('aria-invalid');
  rResult.hidden = true;
  if (!EMAIL_RE.test(email)) {
    lError.textContent = 'Enter a valid email address.';
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return;
  }
  const btn = $('button', lForm);
  busy(btn, true, 'Searching the log...');
  const res = await send('lookup', { email });
  busy(btn, false);
  if (!res.ok) {
    lError.textContent = res.message;
    return;
  }
  lookupEmail = email;
  if (!res.loans.length) {
    rForm.hidden = true;
    lError.textContent = '';
    showResult(rResult, el('h3', { text: 'No open items' }), el('p', {}, 'No borrowed item is open for ', el('strong', { text: email }), '. Check the email you used to borrow.'));
    return;
  }
  lError.textContent = '';
  renderLoans(res.loans);
  rForm.hidden = false;
  $('[data-loans] input').focus();
});

rForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(rForm);
  const loanIds = f.getAll('loan').map(String);
  if (!loanIds.length) {
    rError.textContent = 'Select at least one item to return.';
    $('[data-loans] input')?.focus();
    return;
  }
  rError.textContent = '';
  const btn = $('button[type="submit"]', rForm);
  busy(btn, true, 'Saving to the log...');
  const res = await send('return', { email: lookupEmail, loanIds, condition: f.get('condition'), note: String(f.get('note') || '').trim() });
  busy(btn, false);
  if (!res.ok) {
    rError.textContent = res.message;
    return;
  }
  rForm.hidden = true;
  rForm.reset();
  const nodes = [el('h3', { text: res.returned.length ? 'Equipment signed in' : 'Nothing new to sign in' })];
  if (res.returned.length) nodes.push(el('ul', {}, res.returned.map((n) => el('li', {}, el('strong', { text: n }), el('span', { class: 'badge badge--ok', text: 'Returned' })))));
  if (res.already.length) nodes.push(el('p', { class: 'muted', text: `Already signed in before: ${res.already.join(', ')}.` }));
  if (res.stillOut.length) {
    nodes.push(el('p', {}, 'Still with you: ', el('strong', { text: res.stillOut.map((l) => l.itemName).join(', ') }), '.'));
  } else {
    nodes.push(el('p', { text: 'You have no open items. Reminders stop.' }));
  }
  showResult(rResult, ...nodes);
  await loadCatalog();
});

// ---- Start -----------------------------------------------------------------
if (DEMO) $('[data-demo]').hidden = false;
const cached = readCache();
if (cached) {
  fromCache = true;
  applyCatalog(cached.items);
}
loadCatalog();

// Reveal panels as they enter the view. Without the observer, CSS keeps them visible.
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (en.isIntersecting) {
      en.target.classList.add('is-in');
      io.unobserve(en.target);
    }
  }), { threshold: 0.08 });
  $$('.reveal').forEach((n) => io.observe(n));
} else {
  $$('.reveal').forEach((n) => n.classList.add('is-in'));
}
// A link straight to #borrow or #return must show its panel at once.
const hash = location.hash && document.querySelector(location.hash);
if (hash && hash.classList.contains('reveal')) hash.classList.add('is-in');
