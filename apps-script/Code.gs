/**
 * SHARE Equipment Borrowing Log: data service and daily reminder.
 *
 * Setup (signed in as share@spmcdvo.net):
 * 1. Create a Google Sheet "SHARE Equipment Log". Open Extensions > Apps Script and paste this file.
 * 2. Replace appsscript.json with the copy in this folder (time zone Asia/Manila).
 * 3. Run setup() once from the editor and accept the permissions.
 *    It creates the tabs, adds sample equipment, and installs the 8:00 AM reminder trigger.
 * 4. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 * 5. Paste the /exec address into js/config.js.
 *
 * Staff edit the Equipment tab directly. Set Active to N to stop new loans of an item.
 * The reminder email is sent from the account that owns this script.
 */

var TZ = 'Asia/Manila';
var PAGE_URL = 'https://almanalaysay93-gif.github.io/share-equipment-log/';
var UNIT_EMAIL = 'share@spmcdvo.net';
var MAX_DAYS = 90;
var MAX_ITEMS = 10;

var TABS = {
  Equipment: ['ItemID', 'Name', 'Category', 'Active', 'Notes'],
  Loans: ['LoanID', 'ItemID', 'ItemName', 'BorrowerName', 'Email', 'Department', 'Contact', 'BorrowedAt',
    'DueDate', 'ReturnedAt', 'Condition', 'ReturnNote', 'Status', 'LastReminderAt', 'ReminderCount'],
  Log: ['Timestamp', 'Action', 'LoanID', 'Email', 'Detail']
};
// Column positions in the Loans tab (0-based).
var L = {};
TABS.Loans.forEach(function (h, i) { L[h] = i; });

var SAMPLE_EQUIPMENT = [
  ['EQ-001', 'Laptop (Lenovo ThinkPad)', 'IT', 'Y', 'Sample row. Replace with real items.'],
  ['EQ-002', 'LCD projector', 'IT', 'Y', ''],
  ['EQ-003', 'Portable speaker with microphone', 'AV', 'Y', ''],
  ['EQ-004', 'Extension cord (5 m)', 'Accessories', 'Y', ''],
  ['EQ-005', 'Digital camera', 'AV', 'Y', ''],
  ['EQ-006', 'Cooler box (organ transport)', 'Clinical', 'Y', ''],
  ['EQ-007', 'Tablet (iPad)', 'IT', 'Y', ''],
  ['EQ-008', 'Tarpaulin stand', 'Events', 'Y', '']
];

var CONDITIONS = ['Good', 'Damaged', 'Missing parts'];

// ---- Pure helpers (no Google services) -----------------------------------

function normEmail_(s) {
  return String(s == null ? '' : s).trim().toLowerCase();
}

function cleanText_(s, max) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
}

// A cell that starts with = + - @ is read by Sheets as a formula. The apostrophe keeps it text.
function safeCell_(v) {
  var s = String(v == null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function validEmail_(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 120;
}

function validIsoDate_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Whole days from date a to date b, both 'yyyy-MM-dd'.
function daysBetween_(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

// Returns { ok: true, value } or { ok: false, message }.
function validateBorrow_(req, today) {
  var name = cleanText_(req.name, 80);
  var email = normEmail_(req.email);
  var dept = cleanText_(req.department, 80);
  var contact = cleanText_(req.contact, 20);
  var due = String(req.dueDate || '');
  var ids = Array.isArray(req.itemIds) ? req.itemIds.map(function (x) { return String(x).trim(); }) : [];
  var unique = ids.filter(function (x, i) { return x && ids.indexOf(x) === i; });

  if (name.length < 2) return { ok: false, message: 'Enter your full name.' };
  if (!validEmail_(email)) return { ok: false, message: 'Enter a valid email address.' };
  if (dept.length < 2) return { ok: false, message: 'Enter your department or unit.' };
  if (!/^\+?[0-9][0-9 \-]{6,18}$/.test(contact)) return { ok: false, message: 'Enter a valid contact number.' };
  if (!unique.length) return { ok: false, message: 'Select at least one item.' };
  if (unique.length > MAX_ITEMS) return { ok: false, message: 'Select ' + MAX_ITEMS + ' items or fewer.' };
  if (!validIsoDate_(due)) return { ok: false, message: 'Select the expected return date.' };
  var ahead = daysBetween_(today, due);
  if (ahead < 0) return { ok: false, message: 'The return date cannot be in the past.' };
  if (ahead > MAX_DAYS) return { ok: false, message: 'The return date must be within ' + MAX_DAYS + ' days.' };
  return { ok: true, value: { name: name, email: email, department: dept, contact: contact, dueDate: due, itemIds: unique } };
}

// rows: Loans display values without the header. Returns [{ email, name, items: [{ rowIndex, ... }] }].
function groupOverdue_(rows, today) {
  var groups = {};
  var order = [];
  rows.forEach(function (r, i) {
    if (r[L.Status] !== 'OUT') return;
    var due = String(r[L.DueDate]);
    if (!validIsoDate_(due) || daysBetween_(due, today) < 1) return;
    if (String(r[L.LastReminderAt]).slice(0, 10) === today) return;
    var email = normEmail_(r[L.Email]);
    if (!validEmail_(email)) return;
    if (!groups[email]) { groups[email] = { email: email, name: r[L.BorrowerName], items: [] }; order.push(email); }
    groups[email].items.push({
      rowIndex: i, loanId: r[L.LoanID], itemName: r[L.ItemName], borrowedAt: String(r[L.BorrowedAt]).slice(0, 10),
      dueDate: due, daysOverdue: daysBetween_(due, today), count: Number(r[L.ReminderCount]) || 0
    });
  });
  return order.map(function (e) { return groups[e]; });
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function reminderEmail_(group) {
  var n = group.items.length;
  var subject = 'Overdue equipment: please return to SHARE';
  var lines = group.items.map(function (it) {
    return '- ' + it.itemName + ' (borrowed ' + it.borrowedAt + ', due ' + it.dueDate + ', ' +
      it.daysOverdue + (it.daysOverdue === 1 ? ' day' : ' days') + ' overdue)';
  });
  var body = 'Hello ' + group.name + ',\n\n' +
    'You have ' + n + (n === 1 ? ' item' : ' items') + ' from the SHARE unit past the return date:\n\n' +
    lines.join('\n') + '\n\n' +
    'Please bring the equipment back to the SHARE office and sign it in at:\n' + PAGE_URL + '#return\n\n' +
    'This reminder comes every day until the items are signed in.\n' +
    'Questions: ' + UNIT_EMAIL + '\n\n' +
    'SHARE, Southern Philippines Medical Center';
  var rows = group.items.map(function (it) {
    return '<tr><td style="padding:6px 10px;border-bottom:1px solid #ddd">' + escapeHtml_(it.itemName) + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #ddd">' + it.borrowedAt + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #ddd">' + it.dueDate + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #ddd;color:#b00020;font-weight:bold">' + it.daysOverdue + '</td></tr>';
  }).join('');
  var html = '<div style="font-family:Arial,sans-serif;color:#111;max-width:600px">' +
    '<p>Hello ' + escapeHtml_(group.name) + ',</p>' +
    '<p>You have ' + n + (n === 1 ? ' item' : ' items') + ' from the SHARE unit past the return date:</p>' +
    '<table style="border-collapse:collapse;width:100%;font-size:14px">' +
    '<tr style="background:#0b1220;color:#fff"><th align="left" style="padding:6px 10px">Item</th>' +
    '<th align="left" style="padding:6px 10px">Borrowed</th><th align="left" style="padding:6px 10px">Due</th>' +
    '<th align="left" style="padding:6px 10px">Days overdue</th></tr>' + rows + '</table>' +
    '<p>Please bring the equipment back to the SHARE office and sign it in at ' +
    '<a href="' + PAGE_URL + '#return">' + PAGE_URL + '</a>.</p>' +
    '<p style="color:#555;font-size:13px">This reminder comes every day until the items are signed in. Questions: ' +
    UNIT_EMAIL + '</p><p>SHARE, Southern Philippines Medical Center</p></div>';
  return { subject: subject, body: body, htmlBody: html };
}

// ---- Google services ------------------------------------------------------

function now_() {
  var d = new Date();
  return { date: Utilities.formatDate(d, TZ, 'yyyy-MM-dd'), stamp: Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm:ss'), raw: d };
}

function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // Plain text, so dates and phone numbers stay exactly as written.
    sh.getRange(1, 1, sh.getMaxRows(), TABS[name].length).setNumberFormat('@');
  }
  return sh;
}

function body_(sh) {
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, sh.getLastColumn()).getDisplayValues();
}

function log_(action, loanId, email, detail) {
  try {
    sheet_('Log').appendRow([now_().stamp, action, safeCell_(loanId || ''), safeCell_(email || ''), safeCell_(String(detail || '').slice(0, 500))]);
  } catch (e) { /* The log never blocks a request. */ }
}

function fail_(code, message) {
  return { ok: false, code: code, message: message };
}

function catalog_() {
  var loans = body_(sheet_('Loans'));
  var out = {};
  loans.forEach(function (r) { if (r[L.Status] === 'OUT') out[r[L.ItemID]] = true; });
  var items = body_(sheet_('Equipment'))
    .filter(function (r) { return r[0] && String(r[3]).trim().toUpperCase() === 'Y'; })
    .map(function (r) { return { id: r[0], name: r[1], category: r[2], available: !out[r[0]] }; });
  return { ok: true, items: items, today: now_().date };
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return fail_('BUSY', 'The log is busy. Try again in a few seconds.');
  try { return fn(); } finally { lock.releaseLock(); }
}

function borrow_(req) {
  var t = now_();
  var v = validateBorrow_(req, t.date);
  if (!v.ok) return fail_('INVALID', v.message);
  var b = v.value;
  return withLock_(function () {
    var equipment = {};
    body_(sheet_('Equipment')).forEach(function (r) { if (r[0]) equipment[r[0]] = { name: r[1], active: String(r[3]).trim().toUpperCase() === 'Y' }; });
    var loansSh = sheet_('Loans');
    var out = {};
    body_(loansSh).forEach(function (r) { if (r[L.Status] === 'OUT') out[r[L.ItemID]] = true; });

    var unknown = b.itemIds.filter(function (id) { return !equipment[id] || !equipment[id].active; });
    if (unknown.length) return fail_('INVALID', 'An item is no longer in the list. Reload the page.');
    var taken = b.itemIds.filter(function (id) { return out[id]; });
    if (taken.length) {
      return { ok: false, code: 'ITEM_OUT', itemIds: taken,
        message: taken.map(function (id) { return equipment[id].name; }).join(', ') + ' is already borrowed.' };
    }

    var batch = 'EQ' + Utilities.formatDate(t.raw, TZ, 'yyMMdd-HHmmss') + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
    var rows = b.itemIds.map(function (id, i) {
      var row = TABS.Loans.map(function () { return ''; });
      row[L.LoanID] = batch + '-' + (i + 1);
      row[L.ItemID] = id;
      row[L.ItemName] = equipment[id].name;
      row[L.BorrowerName] = b.name;
      row[L.Email] = b.email;
      row[L.Department] = b.department;
      row[L.Contact] = b.contact;
      row[L.BorrowedAt] = t.stamp;
      row[L.DueDate] = b.dueDate;
      row[L.Status] = 'OUT';
      row[L.ReminderCount] = '0';
      return row.map(safeCell_);
    });
    loansSh.getRange(loansSh.getLastRow() + 1, 1, rows.length, rows[0].length).setNumberFormat('@').setValues(rows);
    rows.forEach(function (r) { log_('BORROW', r[L.LoanID], b.email, r[L.ItemName] + ', due ' + b.dueDate); });
    return { ok: true, loans: rows.map(function (r) { return { loanId: r[L.LoanID], itemName: equipment[r[L.ItemID]].name }; }),
      dueDate: b.dueDate, email: b.email };
  });
}

function openLoans_(rows, email, today) {
  return rows.filter(function (r) { return r[L.Status] === 'OUT' && normEmail_(r[L.Email]) === email; })
    .map(function (r) {
      return { loanId: r[L.LoanID], itemName: r[L.ItemName], borrowedAt: String(r[L.BorrowedAt]).slice(0, 10),
        dueDate: r[L.DueDate], overdue: validIsoDate_(r[L.DueDate]) && daysBetween_(r[L.DueDate], today) >= 1 };
    });
}

function lookup_(req) {
  var email = normEmail_(req.email);
  if (!validEmail_(email)) return fail_('INVALID', 'Enter a valid email address.');
  return { ok: true, loans: openLoans_(body_(sheet_('Loans')), email, now_().date) };
}

function return_(req) {
  var email = normEmail_(req.email);
  if (!validEmail_(email)) return fail_('INVALID', 'Enter a valid email address.');
  var ids = Array.isArray(req.loanIds) ? req.loanIds.map(String) : [];
  if (!ids.length) return fail_('INVALID', 'Select at least one item to return.');
  var condition = CONDITIONS.indexOf(req.condition) >= 0 ? req.condition : 'Good';
  var note = cleanText_(req.note, 300);
  var t = now_();
  return withLock_(function () {
    var sh = sheet_('Loans');
    var rows = body_(sh);
    var returned = [];
    var already = [];
    var missing = [];
    ids.forEach(function (id) {
      var i = -1;
      for (var k = 0; k < rows.length; k++) {
        if (rows[k][L.LoanID] === id && normEmail_(rows[k][L.Email]) === email) { i = k; break; }
      }
      if (i < 0) { missing.push(id); return; }
      if (rows[i][L.Status] !== 'OUT') { already.push(rows[i][L.ItemName]); return; }
      var r = i + 2;
      sh.getRange(r, L.ReturnedAt + 1, 1, 4).setValues([[t.stamp, condition, safeCell_(note), 'RETURNED']]);
      rows[i][L.Status] = 'RETURNED';
      returned.push(rows[i][L.ItemName]);
      log_('RETURN', id, email, rows[i][L.ItemName] + ', ' + condition + (note ? ', ' + note : ''));
    });
    if (!returned.length && !already.length) return fail_('NOT_FOUND', 'No open loan matches this email.');
    return { ok: true, returned: returned, already: already, missing: missing, stillOut: openLoans_(rows, email, t.date) };
  });
}

var HANDLERS = { catalog: catalog_, borrow: borrow_, lookup: lookup_, 'return': return_ };

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(req) {
  var h = HANDLERS[req && req.action];
  if (!h) return fail_('INVALID', 'Unknown action.');
  try {
    return h(req);
  } catch (err) {
    log_('ERROR', '', req && req.email, (req && req.action) + ': ' + (err && err.message));
    return fail_('SERVER', 'The log could not save this. Try again.');
  }
}

function doGet(e) {
  return json_(handle_({ action: (e && e.parameter && e.parameter.action) || 'catalog' }));
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_(fail_('INVALID', 'The request is not valid.')); }
  return json_(handle_(req));
}

// ---- Daily reminder -------------------------------------------------------

function sendOverdueReminders() {
  var t = now_();
  var sh = sheet_('Loans');
  var rows = body_(sh);
  var groups = groupOverdue_(rows, t.date);
  var sent = 0;
  for (var g = 0; g < groups.length; g++) {
    if (MailApp.getRemainingDailyQuota() < 1) {
      log_('ERROR', '', '', 'Mail quota used up. ' + (groups.length - g) + ' borrowers wait for the next run.');
      break;
    }
    var group = groups[g];
    var mail = reminderEmail_(group);
    try {
      MailApp.sendEmail({ to: group.email, subject: mail.subject, body: mail.body, htmlBody: mail.htmlBody, name: 'SHARE Equipment Log', replyTo: UNIT_EMAIL });
    } catch (err) {
      log_('ERROR', '', group.email, 'Reminder failed: ' + (err && err.message));
      continue;
    }
    group.items.forEach(function (it) {
      sh.getRange(it.rowIndex + 2, L.LastReminderAt + 1).setValue(t.stamp);
      sh.getRange(it.rowIndex + 2, L.ReminderCount + 1).setValue(String(it.count + 1));
      log_('REMINDER', it.loanId, group.email, it.itemName + ', ' + it.daysOverdue + ' days overdue');
    });
    sent++;
  }
  return sent;
}

// ---- One-time setup -------------------------------------------------------

function setup() {
  Object.keys(TABS).forEach(sheet_);
  var eq = sheet_('Equipment');
  if (eq.getLastRow() < 2) eq.getRange(2, 1, SAMPLE_EQUIPMENT.length, 5).setValues(SAMPLE_EQUIPMENT);
  var blank = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0) SpreadsheetApp.getActiveSpreadsheet().deleteSheet(blank);
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'sendOverdueReminders') ScriptApp.deleteTrigger(tr);
  });
  ScriptApp.newTrigger('sendOverdueReminders').timeBased().everyDays(1).atHour(8).inTimezone(TZ).create();
}
