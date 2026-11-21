import '../setup-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExpense, CATEGORIES, MAX_AMOUNT } from '../../src/utils/expense.js';

const NOW = new Date('2026-11-17T10:00:00Z');
const fields = (fn) => { try { fn(); } catch (e) { return e.fields; } assert.fail('expected a validation error'); };

test('a normal diesel expense is accepted and rounded to paise', () => {
  const r = parseExpense({ category: 'diesel', amount: '9800.456', litres: 105, date: '2026-11-16', notes: ' Full tank ' }, { now: NOW });
  assert.deepEqual([r.category, r.amount, r.litres, r.notes], ['diesel', 9800.46, 105, 'Full tank']);
  assert.equal(r.date.toISOString().slice(0, 10), '2026-11-16');
});

test('category and amount are required and must make sense', () => {
  assert.ok(fields(() => parseExpense({}, { now: NOW })).category);
  assert.ok(fields(() => parseExpense({ category: 'snacks', amount: 10 }, { now: NOW })).category);
  for (const bad of [undefined, '', 0, -5, 'abc', NaN]) assert.match(fields(() => parseExpense({ category: 'toll', amount: bad }, { now: NOW })).amount, /greater than zero/, String(bad));
  assert.match(fields(() => parseExpense({ category: 'toll', amount: MAX_AMOUNT + 1 }, { now: NOW })).amount, /extra zero/);
});

test('"other" needs a description', () => {
  assert.match(fields(() => parseExpense({ category: 'other', amount: 100 }, { now: NOW })).notes, /Describe/);
  assert.match(fields(() => parseExpense({ category: 'other', amount: 100, notes: '   ' }, { now: NOW })).notes, /Describe/);
  assert.equal(parseExpense({ category: 'other', amount: 100, notes: 'Weighbridge' }, { now: NOW }).notes, 'Weighbridge');
});

test('litres belong to diesel only, and empty means not recorded', () => {
  assert.match(fields(() => parseExpense({ category: 'toll', amount: 100, litres: 20 }, { now: NOW })).litres, /diesel only/);
  assert.equal(parseExpense({ category: 'diesel', amount: 100, litres: '' }, { now: NOW }).litres, null);
  assert.equal(parseExpense({ category: 'diesel', amount: 100, litres: 0 }, { now: NOW }).litres, null);
  assert.ok(fields(() => parseExpense({ category: 'diesel', amount: 100, litres: 5000 }, { now: NOW })).litres);
  assert.ok(fields(() => parseExpense({ category: 'diesel', amount: 100, litres: 'x' }, { now: NOW })).litres);
});

test('dates cannot be in the future or long before the trip', () => {
  assert.match(fields(() => parseExpense({ category: 'toll', amount: 1, date: '2026-12-25' }, { now: NOW })).date, /future/);
  assert.match(fields(() => parseExpense({ category: 'toll', amount: 1, date: 'not a date' }, { now: NOW })).date, /valid/);
  assert.match(fields(() => parseExpense({ category: 'toll', amount: 1, date: '2026-10-01' }, { now: NOW, tripStart: '2026-11-10' })).date, /before the trip/);
  assert.ok(parseExpense({ category: 'toll', amount: 1, date: '2026-11-17' }, { now: NOW }).date, 'today is fine');
});

test('updates only check what was sent, but cross-field rules still hold', () => {
  const existing = { category: 'diesel', amount: 100, litres: 40, notes: '' };
  assert.deepEqual(parseExpense({ amount: 150 }, { partial: true, existing, now: NOW }), { amount: 150 });
  assert.equal(parseExpense({ category: 'toll' }, { partial: true, existing, now: NOW }).litres, null, 'moving away from diesel drops litres');
  assert.match(fields(() => parseExpense({ category: 'other' }, { partial: true, existing, now: NOW })).notes, /Describe/);
  assert.ok(fields(() => parseExpense({ notes: 'x'.repeat(301) }, { partial: true, existing, now: NOW })).notes);
  assert.deepEqual(parseExpense({}, { partial: true, existing, now: NOW }), {}, 'nothing to change is not an error');
});

test('every category is accepted', () => {
  for (const category of CATEGORIES) {
    const body = { category, amount: 10, ...(category === 'other' ? { notes: 'x' } : {}) };
    assert.equal(parseExpense(body, { now: NOW }).category, category);
  }
});
