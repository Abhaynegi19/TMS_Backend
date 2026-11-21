// CSV with a UTF-8 byte-order mark (so Excel reads rupee signs and names correctly), proper quoting,
// and protection against spreadsheet formula injection: a text value starting with = + - @ gets a leading apostrophe.
const TZ = () => process.env.REPORT_TZ || 'Asia/Kolkata';
const DANGEROUS = /^[=+\-@\t\r]/;

// Wall-clock time in the report time zone, as a Date whose UTC fields hold that wall time (what Excel should display).
export function wallClock(d, tz = TZ()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second));
}

export function csvCell(v, type) {
  if (v === null || v === undefined) return '';
  let s;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return '';
    const iso = wallClock(v).toISOString();
    s = type === 'datetime' ? iso.slice(0, 16).replace('T', ' ') : iso.slice(0, 10);
  } else if (typeof v === 'boolean') s = v ? 'Yes' : 'No';
  else if (typeof v === 'number') s = type === 'money' ? v.toFixed(2) : String(v);
  else {
    s = String(v);
    if (DANGEROUS.test(s)) s = `'${s}`;
  }
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns, rows) {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c.key], c.type)).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
