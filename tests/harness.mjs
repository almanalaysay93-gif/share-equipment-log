// Loads apps-script/Code.gs in a Node vm with in-memory stand-ins for the Google services it uses.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const CODE = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

class Sheet {
  constructor(name) { this.name = name; this.cells = []; }
  getLastRow() { return this.cells.length; }
  getLastColumn() { return this.cells.reduce((m, r) => Math.max(m, r.length), 0); }
  getMaxRows() { return 1000; }
  setFrozenRows() {}
  appendRow(row) { this.cells.push(row.map(String)); }
  getRange(r, c, nr = 1, nc = 1) {
    const sh = this;
    const range = {
      setValues(vals) {
        vals.forEach((row, i) => row.forEach((v, j) => {
          const R = r - 1 + i;
          while (sh.cells.length <= R) sh.cells.push([]);
          // Sheets shows a leading apostrophe as plain text without the apostrophe.
          sh.cells[R][c - 1 + j] = String(v).replace(/^'/, '');
        }));
        return range;
      },
      setValue(v) { return range.setValues([[v]]); },
      getDisplayValues() {
        return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => {
          const v = (sh.cells[r - 1 + i] || [])[c - 1 + j];
          return v == null ? '' : v;
        }));
      },
      setNumberFormat() { return range; },
      setFontWeight() { return range; },
    };
    return range;
  }
}

export function load({ now = '2026-10-15T09:00:00+08:00', lockOk = true, quota = 100 } = {}) {
  const sheets = {};
  const mail = [];
  const triggers = [];
  const clock = { now: new Date(now) };
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = new Sheet(n)),
    deleteSheet: (s) => delete sheets[s.name],
  };
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(clock.now.getTime()); }
    static now() { return clock.now.getTime(); }
  }
  const fmt = (d, tz, pattern) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
    return pattern.replace('yyyy', p.year).replace('yy', p.year.slice(2)).replace('MM', p.month).replace('dd', p.day)
      .replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
  };
  const ctx = {
    Date: FakeDate, Math, JSON, String, Number, Array, Object, RegExp, isNaN,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    Utilities: { formatDate: fmt },
    LockService: { getScriptLock: () => ({ tryLock: () => lockOk, releaseLock() {} }) },
    MailApp: { getRemainingDailyQuota: () => quota - mail.length, sendEmail: (m) => mail.push(m) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => ({ body: s }) }) },
    ScriptApp: {
      getProjectTriggers: () => triggers, deleteTrigger: () => {},
      newTrigger: (fn) => { const t = { fn }; const b = { timeBased: () => b, everyDays: () => b, atHour: (h) => { t.hour = h; return b; },
        inTimezone: (z) => { t.tz = z; return b; }, create: () => triggers.push(t) }; return b; },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx, { filename: 'Code.gs' });
  const post = (req) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(req) } }).body);
  const get = (action) => JSON.parse(ctx.doGet({ parameter: action ? { action } : {} }).body);
  return { ctx, sheets, mail, triggers, clock, post, get, setNow: (iso) => { clock.now = new Date(iso); } };
}
