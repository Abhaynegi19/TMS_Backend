import '../setup-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { gstinValid, gstinCheckChar, computeGst, amountInWords, fiscalYear, stateOf, STATES } from '../../src/utils/gst.js';

test('GSTIN validation checks format, state and checksum', () => {
  assert.equal(gstinValid('27AAPFU0939F1ZV'), true);
  assert.equal(gstinValid('27AAPFU0939F1ZW'), false, 'wrong checksum');
  assert.equal(gstinValid('99AAPFU0939F1ZV'), false, 'unknown state');
  assert.equal(gstinValid('27AAPFU0939F1Z'), false, 'too short');
  assert.equal(gstinValid('27aapfu0939f1zv'), false, 'must be upper case');
  assert.equal(gstinValid(''), false);
  assert.equal(gstinValid(undefined), false);
});

test('a generated check character always validates', () => {
  const g = '07AAACH5678K1Z' + gstinCheckChar('07AAACH5678K1Z');
  assert.ok(gstinValid(g));
  assert.equal(stateOf(g), '07');
  assert.equal(STATES['07'], 'Delhi');
});

test('same-state supply splits tax into CGST and SGST', () => {
  assert.deepEqual(computeGst({ taxable: 42000, rate: 5, supplierState: '07', supplyState: '07' }),
    { mode: 'intra', taxable: 42000, rate: 5, cgst: 1050, sgst: 1050, igst: 0, total: 44100 });
});

test('inter-state supply charges IGST', () => {
  const g = computeGst({ taxable: 42000, rate: 5, supplierState: '07', supplyState: '27' });
  assert.equal(g.mode, 'inter');
  assert.equal(g.igst, 2100);
  assert.equal(g.total, 44100);
});

test('zero rate means no tax; unknown state is treated as intra-state', () => {
  assert.equal(computeGst({ taxable: 1000, rate: 0, supplierState: '07', supplyState: '27' }).mode, 'none');
  assert.equal(computeGst({ taxable: 1000, rate: 18 }).mode, 'intra');
});

test('tax is rounded to paise', () => {
  const g = computeGst({ taxable: 1234.57, rate: 18, supplierState: '07', supplyState: '27' });
  assert.equal(g.igst, 222.22);
  assert.equal(g.total, 1456.79);
});

test('amount in words uses the Indian numbering system', () => {
  assert.equal(amountInWords(0), 'Rupees Zero Only');
  assert.equal(amountInWords(21), 'Rupees Twenty One Only');
  assert.equal(amountInWords(100), 'Rupees One Hundred Only');
  assert.equal(amountInWords(44100), 'Rupees Forty Four Thousand One Hundred Only');
  assert.equal(amountInWords(125000), 'Rupees One Lakh Twenty Five Thousand Only');
  assert.equal(amountInWords(12345678), 'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only');
  assert.equal(amountInWords(49560.5), 'Rupees Forty Nine Thousand Five Hundred Sixty and Fifty Paise Only');
});

test('financial year runs April to March', () => {
  assert.equal(fiscalYear(new Date('2026-04-01T10:00:00+05:30')), '2627');
  assert.equal(fiscalYear(new Date('2027-03-31T23:00:00+05:30')), '2627');
  assert.equal(fiscalYear(new Date('2026-03-31T23:30:00+05:30')), '2526');
  assert.equal(fiscalYear(new Date('2026-03-31T20:00:00Z')), '2627', '01:30 IST on 1 April already belongs to the new year');
});
