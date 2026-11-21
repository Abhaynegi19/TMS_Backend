import '../setup-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceBuffer } from '../../src/utils/invoicePdf.js';
import { computeGst } from '../../src/utils/gst.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const snapshot = (extra = {}) => ({
  no: 'DEL/2627/00001', date: new Date('2026-11-01'), dueDate: new Date('2026-12-01'), sac: '9965', placeOfSupplyCode: '07',
  ...computeGst({ taxable: 42000, rate: 5, supplierState: '07', supplyState: '07' }),
  supplier: { name: 'Haulwise', branch: 'Delhi Hub', address: 'Plot 12, Transport Nagar, New Delhi', phone: '+91 11 5550 0101', email: 'delhi@haulwise.test', gstin: '07AAACH5678K1Z0', stateCode: '07' },
  buyer: { name: 'Apex Retail Pvt Ltd', address: '12 Okhla Industrial Area, New Delhi', gstin: '07AAACA1234A1Z0', stateCode: '07' },
  ...extra,
});
const trip = { tripNo: 'TRP-DEL-00007', origin: 'Delhi', destination: 'Jaipur', fare: 42000, distanceKm: 280, cargo: 'Textiles', cargoWeightKg: 8000, paymentStatus: 'paid', scheduledAt: new Date('2026-10-28'), startedAt: new Date('2026-10-28'), completedAt: new Date('2026-10-29') };
const pages = (buf) => (buf.toString('latin1').match(/\/Type \/Page(?!s)/g) || []).length;

test('produces a valid single-page GST invoice', async () => {
  const buf = await invoiceBuffer({ invoice: snapshot(), trip, vehicle: { plate: 'DL01AB1234' }, driver: { name: 'Ravi Kumar' } });
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  assert.match(buf.subarray(-8).toString(), /%%EOF/);
  assert.equal(pages(buf), 1);
});

test('covers intra-state, inter-state, no-tax and unregistered suppliers', async () => {
  const cases = [
    snapshot(),
    snapshot({ ...computeGst({ taxable: 42000, rate: 5, supplierState: '07', supplyState: '27' }), placeOfSupplyCode: '27' }),
    snapshot({ ...computeGst({ taxable: 42000, rate: 0 }) }),
    snapshot({ supplier: { ...snapshot().supplier, gstin: '', stateCode: '' }, buyer: { name: 'Walk-in customer', address: '', gstin: '', stateCode: '' }, placeOfSupplyCode: '' }),
  ];
  for (const invoice of cases) assert.equal(pages(await invoiceBuffer({ invoice, trip })), 1);
});

test('shows proof of delivery with a signature, for every payment status', async () => {
  for (const paymentStatus of ['unpaid', 'partial', 'paid']) {
    const buf = await invoiceBuffer({
      invoice: snapshot(), trip: { ...trip, paymentStatus, pod: { receiverName: 'Meera Shah', deliveredAt: new Date('2026-10-29') } }, signature: PNG,
    });
    assert.equal(pages(buf), 1, paymentStatus);
  }
});

test('an unreadable signature never blocks the invoice', async () => {
  const buf = await invoiceBuffer({ invoice: snapshot(), trip: { ...trip, pod: { receiverName: 'X', deliveredAt: new Date() } }, signature: Buffer.from('not an image') });
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
});

test('very long names still fit on one page', async () => {
  const long = 'Extremely Long Customer Name Limited '.repeat(4);
  const buf = await invoiceBuffer({ invoice: snapshot({ buyer: { name: long, address: long, gstin: '', stateCode: '07' } }), trip: { ...trip, origin: long.slice(0, 60), destination: long.slice(0, 60) } });
  assert.equal(pages(buf), 1);
});
