import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const borrower = (over = {}) => ({
  action: 'borrow', name: 'Juan Dela Cruz', email: 'Juan@Example.com ', department: 'SHARE', contact: '0917 123 4567',
  itemIds: ['EQ-001'], dueDate: '2026-10-17', ...over,
});

function ready(opts) {
  const app = load(opts);
  app.ctx.setup();
  return app;
}

test('setup creates tabs, sample items, and one 8 AM Manila trigger', () => {
  const app = ready();
  assert.deepEqual(Object.keys(app.sheets).sort(), ['Equipment', 'Loans', 'Log']);
  assert.equal(app.sheets.Equipment.getLastRow(), 9);
  assert.equal(app.triggers.length, 1);
  assert.deepEqual([app.triggers[0].fn, app.triggers[0].hour, app.triggers[0].tz], ['sendOverdueReminders', 8, 'Asia/Manila']);
});

test('catalog lists active items with availability', () => {
  const app = ready();
  app.sheets.Equipment.cells[2][3] = 'N';
  const res = app.get();
  assert.equal(res.ok, true);
  assert.equal(res.items.length, 7);
  assert.ok(res.items.every((i) => i.available));
  assert.equal(res.today, '2026-10-15');
});

test('borrow writes one row per item with a normalized email and marks items out', () => {
  const app = ready();
  const res = app.post(borrower({ itemIds: ['EQ-001', 'EQ-002', 'EQ-001'] }));
  assert.equal(res.ok, true);
  assert.equal(res.loans.length, 2);
  const rows = app.sheets.Loans.cells.slice(1);
  assert.equal(rows.length, 2);
  assert.equal(rows[0][4], 'juan@example.com');
  assert.equal(rows[0][12], 'OUT');
  assert.equal(rows[0][8], '2026-10-17');
  const cat = app.get();
  assert.equal(cat.items.find((i) => i.id === 'EQ-001').available, false);
  assert.equal(cat.items.find((i) => i.id === 'EQ-003').available, true);
});

test('borrow of an item that is out returns ITEM_OUT and writes nothing', () => {
  const app = ready();
  app.post(borrower());
  const res = app.post(borrower({ email: 'other@example.com', itemIds: ['EQ-002', 'EQ-001'] }));
  assert.equal(res.ok, false);
  assert.equal(res.code, 'ITEM_OUT');
  assert.deepEqual(res.itemIds, ['EQ-001']);
  assert.equal(app.sheets.Loans.cells.length - 1, 1);
});

test('borrow validation rejects bad input', () => {
  const app = ready();
  const cases = [
    [{ name: 'J' }, 'full name'],
    [{ email: 'nope' }, 'email'],
    [{ department: '' }, 'department'],
    [{ contact: 'abc' }, 'contact'],
    [{ itemIds: [] }, 'at least one'],
    [{ dueDate: '2026-10-14' }, 'past'],
    [{ dueDate: '2027-02-01' }, '90 days'],
    [{ dueDate: '2026-02-30' }, 'return date'],
    [{ itemIds: ['EQ-999'] }, 'no longer'],
  ];
  for (const [over, msg] of cases) {
    const res = app.post(borrower(over));
    assert.equal(res.ok, false, JSON.stringify(over));
    assert.match(res.message, new RegExp(msg), JSON.stringify(over));
  }
  assert.equal(app.sheets.Loans.cells.length, 1);
});

test('borrow on the same day as today is allowed (Manila date, not UTC)', () => {
  // 2026-10-15 07:00 Manila is still 2026-10-14 in UTC.
  const app = ready({ now: '2026-10-15T07:00:00+08:00' });
  assert.equal(app.post(borrower({ dueDate: '2026-10-15' })).ok, true);
});

test('a busy lock returns BUSY', () => {
  const app = ready({ lockOk: false });
  assert.equal(app.post(borrower()).code, 'BUSY');
});

test('cells that start with = + - @ are stored as text', () => {
  const app = ready();
  const loans = app.sheets.Loans;
  // The harness strips the apostrophe as Sheets does on display. The written value must have had it.
  const written = [];
  const orig = loans.getRange.bind(loans);
  loans.getRange = (...a) => { const r = orig(...a); const sv = r.setValues; r.setValues = (v) => { written.push(v); return sv(v); }; return r; };
  app.post(borrower({ name: '=HYPERLINK("x")', contact: '+63 917 123 4567' }));
  const row = written.find((v) => v[0].length === 15)[0];
  assert.equal(row[3], "'=HYPERLINK(\"x\")");
  assert.equal(row[6], "'+63 917 123 4567");
  assert.equal(loans.cells[1][3], '=HYPERLINK("x")');
});

test('lookup lists open loans for the email only, without contact numbers', () => {
  const app = ready();
  app.post(borrower({ itemIds: ['EQ-001', 'EQ-002'] }));
  app.post(borrower({ email: 'b@example.com', itemIds: ['EQ-003'] }));
  const res = app.post({ action: 'lookup', email: ' JUAN@example.com' });
  assert.equal(res.loans.length, 2);
  assert.ok(res.loans.every((l) => !('contact' in l) && !JSON.stringify(l).includes('0917')));
  assert.equal(app.post({ action: 'lookup', email: 'none@example.com' }).loans.length, 0);
});

test('partial return closes chosen loans, reports the rest, and frees the item', () => {
  const app = ready();
  const b = app.post(borrower({ itemIds: ['EQ-001', 'EQ-002'] }));
  const id = b.loans[0].loanId;
  const res = app.post({ action: 'return', email: 'juan@example.com', loanIds: [id], condition: 'Damaged', note: 'Cracked lid' });
  assert.equal(res.ok, true);
  assert.deepEqual(res.returned, ['Laptop (Lenovo ThinkPad)']);
  assert.equal(res.stillOut.length, 1);
  const row = app.sheets.Loans.cells[1];
  assert.deepEqual([row[10], row[11], row[12]], ['Damaged', 'Cracked lid', 'RETURNED']);
  assert.equal(app.get().items.find((i) => i.id === 'EQ-001').available, true);
  const again = app.post({ action: 'return', email: 'juan@example.com', loanIds: [id] });
  assert.equal(again.ok, true);
  assert.deepEqual(again.already, ['Laptop (Lenovo ThinkPad)']);
});

test('a return with another email does not close the loan', () => {
  const app = ready();
  const b = app.post(borrower());
  const res = app.post({ action: 'return', email: 'thief@example.com', loanIds: [b.loans[0].loanId] });
  assert.equal(res.code, 'NOT_FOUND');
  assert.equal(app.sheets.Loans.cells[1][12], 'OUT');
});

test('reminders go only to overdue borrowers, one email each, once per day', () => {
  const app = ready();
  app.post(borrower({ itemIds: ['EQ-001', 'EQ-002'], dueDate: '2026-10-16' }));
  app.post(borrower({ email: 'later@example.com', itemIds: ['EQ-003'], dueDate: '2026-10-20' }));
  const ret = app.post(borrower({ email: 'done@example.com', itemIds: ['EQ-004'], dueDate: '2026-10-15' }));
  app.post({ action: 'return', email: 'done@example.com', loanIds: [ret.loans[0].loanId] });

  app.setNow('2026-10-16T08:05:00+08:00');
  assert.equal(app.ctx.sendOverdueReminders(), 0, 'due today is not overdue');

  app.setNow('2026-10-17T08:05:00+08:00');
  assert.equal(app.ctx.sendOverdueReminders(), 1);
  assert.equal(app.mail.length, 1);
  assert.equal(app.mail[0].to, 'juan@example.com');
  assert.match(app.mail[0].body, /2 items/);
  assert.match(app.mail[0].body, /1 day overdue/);
  assert.equal(app.ctx.sendOverdueReminders(), 0, 'second run the same day sends nothing');

  app.setNow('2026-10-18T08:05:00+08:00');
  assert.equal(app.ctx.sendOverdueReminders(), 1);
  assert.equal(app.sheets.Loans.cells[1][14], '2');
});

test('reminder stops when the mail quota is used up and logs an error', () => {
  const app = ready({ quota: 1 });
  app.post(borrower({ dueDate: '2026-10-15' }));
  app.post(borrower({ email: 'b@example.com', itemIds: ['EQ-002'], dueDate: '2026-10-15' }));
  app.setNow('2026-10-16T08:05:00+08:00');
  assert.equal(app.ctx.sendOverdueReminders(), 1);
  assert.ok(app.sheets.Log.cells.some((r) => r[1] === 'ERROR' && /quota/.test(r[4])));
});

test('reminder email escapes HTML in names', () => {
  const app = ready();
  const m = app.ctx.reminderEmail_({ email: 'a@b.co', name: '<b>x</b>', items: [{ itemName: '<i>', borrowedAt: '2026-10-01', dueDate: '2026-10-02', daysOverdue: 3 }] });
  assert.ok(!m.htmlBody.includes('<b>x</b>'));
  assert.ok(m.htmlBody.includes('&lt;i&gt;'));
});

test('unknown action and broken JSON fail cleanly', () => {
  const app = ready();
  assert.equal(app.post({ action: 'drop' }).code, 'INVALID');
  const res = JSON.parse(app.ctx.doPost({ postData: { contents: '{bad' } }).body);
  assert.equal(res.code, 'INVALID');
});
