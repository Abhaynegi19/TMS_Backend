// Customers + rate cards + GST invoices, maintenance + expiry alerts, proof of delivery + tracking links.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Vehicle from '../../src/models/Vehicle.js';
import Driver from '../../src/models/Driver.js';
import Trip from '../../src/models/Trip.js';
import User from '../../src/models/User.js';
import AlertLog from '../../src/models/AlertLog.js';
import { fiscalYear, gstinCheckChar } from '../../src/utils/gst.js';
import { mailOutbox, resetMailer } from '../../src/utils/mailer.js';
import { mongoose, W, call, newTrip, setStatus, buildWorld, connectTestDb, binary, inDays } from './world.js';

const skipReason = await connectTestDb('features');
const FY = fiscalYear();
const gst = (p) => p + gstinCheckChar(p);
const GST_DEL = gst('07AAACA1234A1Z'), GST_MUM = gst('27AAACN4321B1Z'), GST_DEL_BRANCH = gst('07AAACH5678K1Z');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const C = {}; // customers

// start a trip as dispatcher and complete it
async function runTrip(id, token = W.t.dispDel) {
  assert.equal((await setStatus(id, 'in-transit', token)).status, 200);
  const r = await setStatus(id, 'completed', token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data;
}
const snapshot = async (id) => (await Trip.findById(id)).invoice;

describe('features', { skip: skipReason }, () => {
  before(async () => { await buildWorld(); resetMailer(); });
  after(async () => { delete process.env.GST_RATE; delete process.env.SMTP_HOST; delete process.env.REQUIRE_POD; await mongoose.disconnect(); });

  describe('customers', () => {
    it('dispatchers create customers; the state comes from the GSTIN and email is normalised', async () => {
      const r = await call('post', '/api/customers', W.t.dispDel, { name: 'Apex Retail', email: 'ACCOUNTS@Apex.test', gstin: GST_DEL, address: '12 Okhla', city: 'New Delhi', paymentTermsDays: 30 });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.data.stateCode, '07');
      assert.equal(r.body.data.email, 'accounts@apex.test');
      C.apex = r.body.data;
    });
    it('rejects a bad checksum, a mismatched state and a bad email', async () => {
      let r = await call('post', '/api/customers', W.t.dispDel, { name: 'X', gstin: GST_DEL.slice(0, 14) + (GST_DEL[14] === 'A' ? 'B' : 'A') });
      assert.equal(r.status, 422);
      assert.match(r.body.error.fields.gstin, /valid/);
      r = await call('post', '/api/customers', W.t.dispDel, { name: 'X', gstin: GST_MUM, stateCode: '07' });
      assert.match(r.body.error.fields.stateCode, /does not match/);
      r = await call('post', '/api/customers', W.t.dispDel, { name: 'X', email: 'nope' });
      assert.ok(r.body.error.fields.email);
    });
    it('reports a duplicate GSTIN on the right field, and allows many blank ones', async () => {
      const r = await call('post', '/api/customers', W.t.dispDel, { name: 'Copy', gstin: GST_DEL });
      assert.equal(r.status, 409);
      assert.ok(r.body.error.fields.gstin);
      assert.equal((await call('post', '/api/customers', W.t.dispDel, { name: 'Walk-in 1', gstin: '' })).status, 201);
      assert.equal((await call('post', '/api/customers', W.t.dispDel, { name: 'Walk-in 2', gstin: '' })).status, 201);
    });
    it('is company-wide, with role limits', async () => {
      assert.equal((await call('get', '/api/customers', W.t.mgrMum)).body.data.some((c) => c.name === 'Apex Retail'), true);
      assert.equal((await call('get', '/api/customers', W.t.acctDel)).status, 200);
      assert.equal((await call('post', '/api/customers', W.t.acctDel, { name: 'Y' })).status, 403);
      assert.equal((await call('get', '/api/customers', W.t.drv1)).status, 403);
      assert.equal((await call('delete', '/api/customers/' + C.apex._id, W.t.dispDel)).status, 403);
    });
    it('searches by name and GSTIN', async () => {
      assert.equal((await call('get', '/api/customers?q=apex', W.t.dispDel)).body.data.length, 1);
      assert.equal((await call('get', `/api/customers?q=${GST_DEL}`, W.t.dispDel)).body.data.length, 1);
    });
    it('a Mumbai customer for later', async () => {
      const r = await call('post', '/api/customers', W.t.mgrMum, { name: 'Northwind Foods', email: 'billing@northwind.test', gstin: GST_MUM, paymentTermsDays: 15 });
      assert.equal(r.status, 201);
      C.north = r.body.data;
    });
  });

  describe('rate cards and fare quotes', () => {
    it('only a Super Admin can edit rate cards', async () => {
      const card = { name: 'Standard truck', vehicleType: 'truck', baseFare: 2000, perKm: 18, perTonne: 100, minFare: 5000 };
      assert.equal((await call('post', '/api/rates', W.t.mgrDel, card)).status, 403);
      assert.equal((await call('post', '/api/rates', W.t.admin, card)).status, 201);
      const r = await call('post', '/api/rates', W.t.admin, { name: 'Apex contract', customer: C.apex._id, baseFare: 1000, perKm: 15, perTonne: 90, minFare: 4000 });
      assert.equal(r.status, 201);
      assert.equal((await call('post', '/api/rates', W.t.admin, { name: 'Bad', customer: new mongoose.Types.ObjectId().toString() })).status, 422);
    });
    it('quotes with the most specific card', async () => {
      const q = (customer, extra = {}) => call('post', '/api/rates/quote', W.t.dispDel, { customer, vehicleType: 'truck', distanceKm: 280, cargoWeightKg: 8000, ...extra });
      let r = await q(C.apex._id);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.data.rateCard.name, 'Apex contract');
      assert.equal(r.body.data.fare, 5920);
      r = await q(C.north._id);
      assert.equal(r.body.data.rateCard.name, 'Standard truck');
      assert.equal(r.body.data.fare, 7840);
    });
    it('applies the minimum fare', async () => {
      const r = await call('post', '/api/rates/quote', W.t.dispDel, { customer: C.apex._id, vehicleType: 'truck', distanceKm: 10, cargoWeightKg: 100 });
      assert.equal(r.body.data.fare, 4000);
      assert.equal(r.body.data.minApplied, true);
    });
    it('explains when no card matches, and validates input', async () => {
      let r = await call('post', '/api/rates/quote', W.t.dispDel, { customer: C.north._id, vehicleType: 'van', distanceKm: 5 });
      assert.equal(r.status, 422);
      assert.equal(r.body.error.code, 'BUSINESS_RULE');
      r = await call('post', '/api/rates/quote', W.t.dispDel, { distanceKm: -1 });
      assert.ok(r.body.error.fields.customer && r.body.error.fields.distanceKm);
    });
    it('accountants and dispatchers can quote; drivers cannot', async () => {
      assert.equal((await call('post', '/api/rates/quote', W.t.acctDel, { customer: C.apex._id })).status, 200);
      assert.equal((await call('post', '/api/rates/quote', W.t.drv1, { customer: C.apex._id })).status, 403);
    });
  });

  describe('trips linked to customers', () => {
    it('picking a customer fills in the trip\'s customer name', async () => {
      const t = await newTrip({ customerRef: C.apex._id });
      assert.equal(t.customer, 'Apex Retail');
      assert.equal(t.customerRef.name, 'Apex Retail');
    });
    it('refuses inactive or unknown customers and asks for one when missing', async () => {
      await call('put', `/api/customers/${C.north._id}`, W.t.mgrMum, { isActive: false });
      let r = await call('post', '/api/trips', W.t.dispDel, { customerRef: C.north._id, origin: 'A', destination: 'B', scheduledAt: new Date().toISOString() });
      assert.equal(r.status, 422);
      assert.ok(r.body.error.fields.customerRef);
      await call('put', `/api/customers/${C.north._id}`, W.t.mgrMum, { isActive: true });
      r = await call('post', '/api/trips', W.t.dispDel, { customerRef: new mongoose.Types.ObjectId().toString(), origin: 'A', destination: 'B', scheduledAt: new Date().toISOString() });
      assert.ok(r.body.error.fields.customerRef);
      r = await call('post', '/api/trips', W.t.dispDel, { origin: 'A', destination: 'B', scheduledAt: new Date().toISOString() });
      assert.ok(r.body.error.fields.customer && r.body.error.fields.customerRef);
    });
    it('customers with trips cannot be deleted', async () => {
      const r = await call('delete', `/api/customers/${C.apex._id}`, W.t.mgrDel);
      assert.equal(r.status, 409);
      assert.match(r.body.error.message, /inactive/);
    });
  });

  describe('GST invoices', () => {
    const T = {};
    before(async () => {
      await call('put', `/api/branches/${W.del._id}`, W.t.admin, { gstin: GST_DEL_BRANCH, address: 'Plot 12, Transport Nagar', phone: '+91 11 5550 0101' });
      process.env.GST_RATE = '5';
      T.intra = await newTrip({ customerRef: C.apex._id, vehicle: String(W.v1._id), driver: String(W.d1._id), fare: 42000, distanceKm: 280 });
      await runTrip(T.intra._id);
    });
    it('validates branch GST details', async () => {
      let r = await call('put', `/api/branches/${W.del._id}`, W.t.admin, { gstin: 'BADGSTIN' });
      assert.ok(r.body.error.fields.gstin);
      r = await call('put', `/api/branches/${W.del._id}`, W.t.admin, { stateCode: '27' });
      assert.match(r.body.error.fields.stateCode, /does not match/);
    });
    it('same-state supply is split into CGST and SGST', async () => {
      const r = await call('get', `/api/trips/${T.intra._id}/invoice`, W.t.acctDel).buffer(true).parse(binary);
      assert.equal(r.status, 200);
      assert.match(r.headers['content-type'], /application\/pdf/);
      assert.match(r.headers['content-disposition'], new RegExp(`DEL-${FY}-00001\\.pdf`));
      const inv = await snapshot(T.intra._id);
      assert.equal(inv.no, `DEL/${FY}/00001`);
      assert.ok(inv.no.length <= 16);
      assert.deepEqual([inv.mode, inv.cgst, inv.sgst, inv.igst, inv.total], ['intra', 1050, 1050, 0, 44100]);
      assert.equal(inv.supplier.gstin, GST_DEL_BRANCH);
      assert.equal(inv.buyer.gstin, GST_DEL);
      assert.equal(inv.sac, '9965');
    });
    it('an issued invoice never changes, even if the tax rate does', async () => {
      process.env.GST_RATE = '18';
      await call('get', `/api/trips/${T.intra._id}/invoice`, W.t.acctDel).buffer(true).parse(binary);
      const inv = await snapshot(T.intra._id);
      assert.equal(inv.total, 44100);
      assert.equal(inv.rate, 5);
      process.env.GST_RATE = '5';
    });
    it('inter-state supply is charged as IGST, numbered in sequence, with the customer\'s payment terms', async () => {
      T.inter = await newTrip({ customerRef: C.north._id, vehicle: String(W.v1._id), driver: String(W.d1._id), fare: 42000 });
      await runTrip(T.inter._id);
      await call('get', `/api/trips/${T.inter._id}/invoice`, W.t.mgrDel).buffer(true).parse(binary);
      const inv = await snapshot(T.inter._id);
      assert.deepEqual([inv.mode, inv.igst, inv.cgst, inv.total, inv.placeOfSupplyCode], ['inter', 2100, 0, 44100, '27']);
      assert.equal(inv.no, `DEL/${FY}/00002`);
      assert.equal(Math.round((new Date(inv.dueDate) - new Date(inv.date)) / 864e5), 15);
    });
    it('emails the PDF to the customer', async () => {
      const before = mailOutbox().length;
      const r = await call('post', `/api/trips/${T.inter._id}/invoice/email`, W.t.acctDel, {});
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.data.mailMode, 'log');
      const mail = mailOutbox().at(-1);
      assert.equal(mailOutbox().length, before + 1);
      assert.deepEqual(mail.to, ['billing@northwind.test']);
      assert.deepEqual(mail.attachments, [`DEL-${FY}-00002.pdf`]);
      assert.match(mail.subject, /DEL\/\d{4}\/00002/);
    });
    it('asks for an address when the customer has none, and validates it', async () => {
      T.plain = await newTrip({ vehicle: String(W.v1._id), driver: String(W.d1._id), fare: 1000 });
      await runTrip(T.plain._id);
      let r = await call('post', `/api/trips/${T.plain._id}/invoice/email`, W.t.acctDel, {});
      assert.equal(r.status, 422);
      assert.ok(r.body.error.fields.to);
      r = await call('post', `/api/trips/${T.plain._id}/invoice/email`, W.t.acctDel, { to: 'bad' });
      assert.ok(r.body.error.fields.to);
      assert.equal((await call('post', `/api/trips/${T.plain._id}/invoice/email`, W.t.acctDel, { to: 'ok@example.test' })).status, 200);
    });
    it('reports a mail server failure instead of pretending it was sent', async () => {
      process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = '1'; resetMailer();
      const r = await call('post', `/api/trips/${T.inter._id}/invoice/email`, W.t.acctDel, {});
      assert.equal(r.status, 502);
      assert.equal(r.body.error.code, 'MAIL_FAILED');
      delete process.env.SMTP_HOST; delete process.env.SMTP_PORT; resetMailer();
    });
    it('dispatchers cannot email invoices', async () => {
      assert.equal((await call('post', `/api/trips/${T.inter._id}/invoice/email`, W.t.dispDel, {})).status, 403);
    });
  });

  describe('maintenance records', () => {
    it('a service record resets the vehicle\'s service clock and odometer', async () => {
      const r = await call('post', '/api/maintenance', W.t.dispDel, { vehicle: String(W.v1._id), type: 'service', date: new Date().toISOString(), odometerKm: 12000, cost: 8000, vendor: 'Sharma Motors' });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      const v = await Vehicle.findById(W.v1._id);
      assert.equal(v.lastServiceKm, 12000);
      assert.equal(v.odometerKm, 12000);
    });
    it('an older record does not overwrite a newer service date', async () => {
      const before = (await Vehicle.findById(W.v1._id)).lastService;
      await call('post', '/api/maintenance', W.t.dispDel, { vehicle: String(W.v1._id), type: 'service', date: inDays(-400).toISOString(), odometerKm: 3000 });
      assert.equal(+(await Vehicle.findById(W.v1._id)).lastService, +before);
    });
    it('defaults the odometer, and rejects other branches\' vehicles', async () => {
      const r = await call('post', '/api/maintenance', W.t.dispDel, { vehicle: String(W.v2._id), type: 'tyres', date: new Date().toISOString(), cost: 4000 });
      assert.equal(r.body.data.odometerKm, 0);
      const bad = await call('post', '/api/maintenance', W.t.dispDel, { vehicle: String(W.vMum._id), date: new Date().toISOString() });
      assert.equal(bad.status, 422);
      assert.match(bad.body.error.fields.vehicle, /different branch/);
      assert.ok((await call('post', '/api/maintenance', W.t.dispDel, { date: new Date().toISOString() })).body.error.fields.vehicle);
    });
    it('is scoped by branch and by role', async () => {
      assert.equal((await call('get', '/api/maintenance', W.t.mgrMum)).body.data.length, 0);
      assert.ok((await call('get', '/api/maintenance', W.t.acctDel)).body.data.length >= 2);
      assert.equal((await call('post', '/api/maintenance', W.t.acctDel, { vehicle: String(W.v1._id), date: new Date().toISOString() })).status, 403);
      assert.equal((await call('get', '/api/maintenance', W.t.drv1)).status, 403);
    });
    it('completing a trip adds its distance to the odometer', async () => {
      const t = await newTrip({ vehicle: String(W.v2._id), driver: String(W.d2._id), distanceKm: 150 });
      await runTrip(t._id);
      assert.equal((await Vehicle.findById(W.v2._id)).odometerKm, 150);
    });
  });

  describe('expiry and maintenance alerts', () => {
    before(async () => {
      resetMailer();
      await Vehicle.updateOne({ _id: W.v1._id }, { insuranceExpiry: inDays(10), serviceIntervalKm: 10000, lastServiceKm: 0, odometerKm: 9500 });
      await Vehicle.updateOne({ _id: W.vMum._id }, { insuranceExpiry: inDays(3) });
      await Driver.updateOne({ _id: W.d2._id }, { licenseExpiry: inDays(5) });
    });
    const labels = (r) => r.body.data.map((a) => `${a.kind}:${a.subject}`);
    it('lists what needs attention, scoped to the branch', async () => {
      const r = await call('get', '/api/alerts', W.t.mgrDel);
      assert.equal(r.status, 200);
      const l = labels(r);
      for (const x of ['insurance:DL01', 'license:Sanjay', 'license:Expired', 'service-km:DL01']) assert.ok(l.includes(x), x);
      assert.ok(!l.includes('insurance:MH01'));
      assert.equal(r.body.data[0].severity, 'expired', 'overdue items come first');
      assert.deepEqual(labels(await call('get', '/api/alerts', W.t.mgrMum)), ['insurance:MH01']);
    });
    it('accountants and dispatchers can read, drivers cannot, only managers can send', async () => {
      assert.equal((await call('get', '/api/alerts', W.t.acctDel)).status, 200);
      assert.equal((await call('get', '/api/alerts', W.t.drv1)).status, 403);
      assert.equal((await call('post', '/api/alerts/run', W.t.dispDel)).status, 403);
    });
    it('emails one digest to the branch managers', async () => {
      const r = await call('post', '/api/alerts/run', W.t.mgrDel);
      assert.equal(r.status, 200);
      assert.equal(r.body.data.branches.length, 1);
      assert.deepEqual([r.body.data.branches[0].sent, r.body.data.branches[0].recipients], [true, ['mgr.del@t.test']]);
      const mail = mailOutbox().at(-1);
      assert.match(mail.subject, /Delhi Hub/);
      assert.match(mail.text, /DL01/);
      assert.match(mail.text, /Sanjay/);
      assert.ok(!mail.text.includes('MH01'));
    });
    it('does not send the same reminder twice', async () => {
      const n = mailOutbox().length;
      const r = await call('post', '/api/alerts/run', W.t.mgrDel);
      assert.equal(r.body.data.newAlerts, 0);
      assert.equal(mailOutbox().length, n);
    });
    it('sends again when a deadline reaches its next stage', async () => {
      await Vehicle.updateOne({ _id: W.v1._id }, { insuranceExpiry: inDays(2) });
      const r = await call('post', '/api/alerts/run', W.t.mgrDel);
      assert.equal(r.body.data.newAlerts, 1);
      assert.match(mailOutbox().at(-1).text, /insurance|Insurance/);
    });
    it('clears an alert once the document is renewed', async () => {
      await Vehicle.updateOne({ _id: W.v1._id }, { insuranceExpiry: inDays(400) });
      assert.ok(!labels(await call('get', '/api/alerts', W.t.mgrDel)).includes('insurance:DL01'));
    });
    it('reports a branch with nobody to email', async () => {
      await User.updateOne({ _id: W.users.mgrMum._id }, { isActive: false });
      const r = await call('post', '/api/alerts/run', W.t.admin);
      const mum = r.body.data.branches.find((b) => b.branch === 'MUM');
      assert.equal(mum.sent, false);
      assert.match(mum.reason, /No recipients/);
      await User.updateOne({ _id: W.users.mgrMum._id }, { isActive: true });
    });
    it('reports a mail failure and retries later, marking nothing as sent', async () => {
      await Driver.updateOne({ _id: W.d1._id }, { licenseExpiry: inDays(2) });
      process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = '1'; resetMailer();
      const logged = await AlertLog.countDocuments();
      let r = await call('post', '/api/alerts/run', W.t.mgrDel);
      assert.equal(r.body.data.branches[0].sent, false);
      assert.match(r.body.data.branches[0].reason, /Email failed/);
      assert.equal(await AlertLog.countDocuments(), logged);
      delete process.env.SMTP_HOST; delete process.env.SMTP_PORT; resetMailer();
      r = await call('post', '/api/alerts/run', W.t.mgrDel);
      assert.equal(r.body.data.branches[0].sent, true);
    });
  });

  describe('proof of delivery', () => {
    const P = {};
    const podFile = (tripId, name) => path.join(process.env.UPLOAD_DIR, 'pod', String(tripId), name);
    before(async () => {
      P.trip = await newTrip({ vehicle: String(W.v1._id), driver: String(W.d1._id), fare: 9000, distanceKm: 100 });
      assert.equal((await setStatus(P.trip._id, 'in-transit', W.t.drv1)).status, 200);
    });
    it('the driver submits photos, a signature and where it happened', async () => {
      const r = await call('post', `/api/trips/${P.trip._id}/pod`, W.t.drv1, { receiverName: 'Meera Shah', notes: 'Left at gate', photos: [PNG], signature: PNG, lat: 26.9, lng: 75.8 });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.data.photos.length, 1);
      P.pod = r.body.data;
      assert.ok(fs.existsSync(podFile(P.trip._id, P.pod.photos[0])));
    });
    it('serves the files privately to people with access to the trip', async () => {
      const url = `/api/trips/${P.trip._id}/pod/${P.pod.photos[0]}`;
      const ok = await call('get', url, W.t.mgrDel).buffer(true).parse(binary);
      assert.equal(ok.status, 200);
      assert.match(ok.headers['content-type'], /image\/png/);
      assert.equal(ok.body.subarray(1, 4).toString(), 'PNG');
      assert.equal((await call('get', url)).status, 401);
      assert.equal((await call('get', url, W.t.mgrMum)).status, 404, 'other branches cannot see it');
      assert.equal((await call('get', `/api/trips/${P.trip._id}/pod/..%2F..%2Fpackage.json`, W.t.mgrDel)).status, 404);
      assert.equal((await call('get', `/api/trips/${P.trip._id}/pod/${P.pod.signature}`, W.t.dispDel)).status, 200);
    });
    it('validates the submission', async () => {
      const post = (body) => call('post', `/api/trips/${P.trip._id}/pod`, W.t.drv1, body);
      assert.ok((await post({ photos: [PNG] })).body.error.fields.receiverName);
      assert.match((await post({ receiverName: 'X' })).body.error.fields.photos, /at least one/);
      assert.match((await post({ receiverName: 'X', photos: [PNG, PNG, PNG, PNG] })).body.error.fields.photos, /at most 3/);
      assert.match((await post({ receiverName: 'X', photos: ['data:text/html;base64,PGI+'] })).body.error.fields.photos, /JPEG or PNG/);
      const fake = `data:image/png;base64,${Buffer.from('<script>x</script>').toString('base64')}`;
      assert.match((await post({ receiverName: 'X', photos: [fake] })).body.error.fields.photos, /not a valid/);
      assert.ok((await post({ receiverName: 'X', photos: [PNG], lat: 500, lng: 0 })).body.error.fields.lat);
    });
    it('only the assigned driver or dispatch can submit, and only for trips on the road', async () => {
      assert.equal((await call('post', `/api/trips/${P.trip._id}/pod`, W.t.drv2, { receiverName: 'X', photos: [PNG] })).status, 404);
      assert.equal((await call('post', `/api/trips/${P.trip._id}/pod`, W.t.acctDel, { receiverName: 'X', photos: [PNG] })).status, 403);
      assert.equal((await call('post', `/api/trips/${P.trip._id}/pod`, W.t.mgrMum, { receiverName: 'X', photos: [PNG] })).status, 404);
      const planned = await newTrip();
      const r = await call('post', `/api/trips/${planned._id}/pod`, W.t.dispDel, { receiverName: 'X', photos: [PNG] });
      assert.equal(r.status, 422);
      assert.match(r.body.error.message, /in transit/);
    });
    it('replacing the proof removes the old files', async () => {
      const old = P.pod.photos[0];
      const r = await call('post', `/api/trips/${P.trip._id}/pod`, W.t.dispDel, { receiverName: 'Meera Shah', photos: [PNG, PNG] });
      assert.equal(r.status, 201);
      assert.equal(fs.existsSync(podFile(P.trip._id, old)), false);
      assert.equal(r.body.data.photos.length, 2);
      assert.equal(r.body.data.signature, undefined);
    });
    it('can be required before a trip is completed', async () => {
      process.env.REQUIRE_POD = 'true';
      const t = await newTrip({ vehicle: String(W.v2._id), driver: String(W.d2._id) });
      await setStatus(t._id, 'in-transit', W.t.drv2);
      const blocked = await setStatus(t._id, 'completed', W.t.drv2);
      assert.equal(blocked.status, 422);
      assert.ok(blocked.body.error.fields.pod);
      await call('post', `/api/trips/${t._id}/pod`, W.t.drv2, { receiverName: 'Gate guard', photos: [PNG] });
      assert.equal((await setStatus(t._id, 'completed', W.t.drv2)).status, 200);
      delete process.env.REQUIRE_POD;
    });
    it('appears on the invoice, and deleting the trip removes the files', async () => {
      assert.equal((await setStatus(P.trip._id, 'completed', W.t.drv1)).status, 200);
      const inv = await call('get', `/api/trips/${P.trip._id}/invoice`, W.t.acctDel).buffer(true).parse(binary);
      assert.equal(inv.status, 200);
      const names = (await Trip.findById(P.trip._id)).pod.photos;
      assert.equal((await call('delete', `/api/trips/${P.trip._id}`, W.t.mgrDel)).status, 200);
      assert.equal(fs.existsSync(path.join(process.env.UPLOAD_DIR, 'pod', String(P.trip._id))), false);
      assert.ok(names.length);
    });
  });

  describe('customer tracking links', () => {
    const L = {};
    const tokenOf = (url) => url.split('/track/')[1];
    const pub = (token) => call('get', `/api/public/track/${token}`);
    before(async () => {
      L.trip = await newTrip({ customerRef: C.north._id, vehicle: String(W.v1._id), driver: String(W.d1._id), fare: 77777, distanceKm: 300 });
      await setStatus(L.trip._id, 'in-transit', W.t.dispDel);
      await call('post', `/api/trips/${L.trip._id}/location`, W.t.drv1, { lat: 27.5, lng: 77.7, speed: 55 });
    });
    it('creates a link that works without signing in and shows only safe details', async () => {
      const r = await call('post', `/api/trips/${L.trip._id}/share`, W.t.dispDel, {});
      assert.equal(r.status, 201, JSON.stringify(r.body));
      L.token = tokenOf(r.body.data.url);
      assert.match(L.token, /^[A-Za-z0-9_-]{32}$/);
      const p = await pub(L.token);
      assert.equal(p.status, 200);
      assert.equal(p.headers['cache-control'], 'no-store');
      assert.deepEqual(Object.keys(p.body.data).sort(), ['branch', 'completedAt', 'delivery', 'destination', 'destinationBranchName', 'driverFirstName', 'expiresAt', 'location', 'origin', 'scheduledAt', 'startedAt', 'status', 'trail', 'tripNo', 'vehiclePlate']);
      assert.equal(p.body.data.status, 'in-transit');
      assert.equal(p.body.data.location.lat, 27.5);
      assert.equal(p.body.data.driverFirstName, 'Ravi');
      const text = JSON.stringify(p.body);
      for (const secret of ['77777', 'Northwind', 'billing@', 'phone":"1', String(L.trip._id)]) assert.ok(!text.includes(secret), `leaked ${secret}`);
    });
    it('stores only a hash of the token', async () => {
      const doc = await Trip.findById(L.trip._id).lean();
      assert.notEqual(doc.trackHash, L.token);
      assert.equal(doc.trackHash.length, 64);
      assert.ok(!JSON.stringify(doc).includes(L.token));
    });
    it('a new link retires the old one, and a link can be revoked', async () => {
      const second = tokenOf((await call('post', `/api/trips/${L.trip._id}/share`, W.t.dispDel, {})).body.data.url);
      assert.equal((await pub(L.token)).status, 404);
      assert.equal((await pub(second)).status, 200);
      assert.equal((await call('delete', `/api/trips/${L.trip._id}/share`, W.t.dispDel)).status, 200);
      assert.equal((await pub(second)).status, 404);
      L.token = tokenOf((await call('post', `/api/trips/${L.trip._id}/share`, W.t.dispDel, {})).body.data.url);
    });
    it('expired, malformed and unknown links all give the same answer', async () => {
      await Trip.updateOne({ _id: L.trip._id }, { trackExpiresAt: inDays(-1) });
      const expired = await pub(L.token);
      await Trip.updateOne({ _id: L.trip._id }, { trackExpiresAt: inDays(5) });
      const bad = [await pub('short'), await pub('x'.repeat(100)), await pub('A'.repeat(32))];
      for (const r of [expired, ...bad]) {
        assert.equal(r.status, 404);
        assert.equal(r.body.error.message, 'This tracking link is invalid or has expired');
      }
    });
    it('emails the link to the customer, and says so when email fails', async () => {
      const r = await call('post', `/api/trips/${L.trip._id}/share`, W.t.dispDel, { email: true });
      assert.equal(r.body.data.emailed, true);
      const mail = mailOutbox().at(-1);
      assert.deepEqual(mail.to, ['billing@northwind.test']);
      assert.ok(mail.text.includes(r.body.data.url));
      L.token = tokenOf(r.body.data.url);
      process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = '1'; resetMailer();
      const bad = await call('post', `/api/trips/${L.trip._id}/share`, W.t.dispDel, { email: true });
      assert.equal(bad.status, 201);
      assert.equal(bad.body.data.emailed, false);
      assert.ok(bad.body.data.url && bad.body.data.emailError);
      delete process.env.SMTP_HOST; delete process.env.SMTP_PORT; resetMailer();
      L.token = tokenOf(bad.body.data.url);
    });
    it('needs a customer email to send, and respects roles and branches', async () => {
      const noEmail = await newTrip();
      assert.ok((await call('post', `/api/trips/${noEmail._id}/share`, W.t.dispDel, { email: true })).body.error.fields.email);
      assert.equal((await call('post', `/api/trips/${L.trip._id}/share`, W.t.acctDel, {})).status, 403);
      assert.equal((await call('post', `/api/trips/${L.trip._id}/share`, W.t.drv1, {})).status, 403);
      assert.equal((await call('post', `/api/trips/${L.trip._id}/share`, W.t.mgrMum, {})).status, 404);
      const cancelled = await newTrip();
      await setStatus(cancelled._id, 'cancelled', W.t.dispDel);
      assert.equal((await call('post', `/api/trips/${cancelled._id}/share`, W.t.dispDel, {})).status, 422);
    });
    it('after delivery shows who received it and stops sharing the location', async () => {
      await call('post', `/api/trips/${L.trip._id}/pod`, W.t.drv1, { receiverName: 'Arjun Rao', photos: [PNG] });
      assert.equal((await setStatus(L.trip._id, 'completed', W.t.drv1)).status, 200);
      const p = await pub(L.token);
      assert.equal(p.status, 200);
      assert.equal(p.body.data.status, 'completed');
      assert.equal(p.body.data.location, null);
      assert.deepEqual(p.body.data.trail, []);
      assert.equal(p.body.data.delivery.receiverName, 'Arjun Rao');
      assert.ok(!JSON.stringify(p.body).includes('.png'), 'no photo files are exposed');
    });
  });
});
