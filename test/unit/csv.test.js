import '../setup-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, toCsv, wallClock } from '../../src/utils/csv.js';

test('quotes cells that contain commas, quotes or line breaks', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
});

test('blocks spreadsheet formula injection in text', () => {
  for (const bad of ['=SUM(A1)', '+1', '-2+3', '@cmd', '=HYPERLINK("http://x")']) {
    assert.ok(csvCell(bad).replace(/^"/, '').startsWith("'"), bad);
  }
  assert.equal(csvCell(-5), '-5', 'genuine negative numbers are not text');
  assert.equal(csvCell('Rama - Sons'), 'Rama - Sons', 'a dash inside text is fine');
});

test('numbers, money, booleans and blanks', () => {
  assert.equal(csvCell(42), '42');
  assert.equal(csvCell(1234.5, 'money'), '1234.50');
  assert.equal(csvCell(true), 'Yes');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
});

test('dates use the report time zone (IST by default)', () => {
  const d = new Date('2026-11-17T20:00:00Z'); // 01:30 on 18 Nov in India
  assert.equal(csvCell(d, 'date'), '2026-11-18');
  assert.equal(csvCell(d, 'datetime'), '2026-11-18 01:30');
  assert.equal(wallClock(d, 'UTC').toISOString(), '2026-11-17T20:00:00.000Z');
  assert.equal(csvCell(new Date('nope'), 'date'), '');
});

test('toCsv writes a BOM, a header and CRLF rows', () => {
  const out = toCsv([{ key: 'a', header: 'Name' }, { key: 'b', header: 'Fare (₹)', type: 'money' }], [{ a: 'Ravi, K', b: 10 }, { a: '=x', b: 2.5 }]);
  assert.equal(out.charCodeAt(0), 0xfeff);
  assert.equal(out.slice(1), 'Name,Fare (₹)\r\n"Ravi, K",10.00\r\n\'=x,2.50\r\n');
});
