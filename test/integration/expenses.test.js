// Trip expenses: drivers add, accountants/managers/super admins edit, managers/super admins delete.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Trip from '../../src/models/Trip.js';
import Expense from '../../src/models/Expense.js';
import AuditLog from '../../src/models/AuditLog.js';
import { mongoose, W, call, newTrip, setStatus, buildWorld, connectTestDb, inDays } from './world.js';

const skipReason = await connectTestDb('expenses');
const add = (token, body) => call('post', '/api/expenses', token, body);
const E = {}; // shared ids

describe('trip expenses', { skip: skipReason }, () => {
  before(async () => {
    await buildWorld();
    // a trip on the road for driver Ravi (drv1), a planned trip for Sanjay (drv2), and one completed trip
    E.road = await newTrip({ vehicle: String(W.v1._id), driver: String(W.d1._id), fare: 20000, distanceKm: 200 });
    await setStatus(E.road._id, 'in-transit', W.t.dispDel);
    E.planned = await newTrip({ vehicle: String(W.v2._id), driver: String(W.d2._id) });
    E.done = await newTrip({ vehicle: String(W.v2._id), driver: String(W.d2._id) });
    await setStatus(E.done._id, 'in-transit', W.t.dispDel);
    await setStatus(E.done._id, 'completed', W.t.dispDel);
    E.cancelled = await newTrip();
    await setStatus(E.cancelled._id, 'cancelled', W.t.dispDel);
  });
  after(async () => { delete process.env.DRIVER_EXPENSE_DAYS; await mongoose.disconnect(); });

  describe('adding', () => {
    it('a driver records diesel on their own trip; branch, driver and vehicle come from the trip', async () => {
      const r = await add(W.t.drv1, { trip: E.road._id, category: 'diesel', amount: 9800, litres: 105, notes: 'Neemrana' });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      const x = r.body.data;
      assert.deepEqual([x.category, x.amount, x.litres, x.branch.code, x.trip.tripNo, x.createdBy.name], ['diesel', 9800, 105, 'DEL', E.road.tripNo, 'Ravi']);
      const doc = await Expense.findById(x._id);
      assert.equal(String(doc.driver), String(W.d1._id));
      assert.equal(String(doc.vehicle), String(W.v1._id));
      E.diesel = x;
    });
    it('toll and other, with the date defaulting to now', async () => {
      const toll = await add(W.t.drv1, { trip: E.road._id, category: 'toll', amount: 450 });
      assert.equal(toll.status, 201);
      assert.ok(Math.abs(new Date(toll.body.data.date) - Date.now()) < 60000);
      E.toll = toll.body.data;
      const other = await add(W.t.drv1, { trip: E.road._id, category: 'other', amount: 300, notes: 'Weighbridge fee' });
      assert.equal(other.status, 201);
      E.other = other.body.data;
    });
    it('rejects bad input field by field', async () => {
      const base = { trip: E.road._id, category: 'toll', amount: 100 };
      assert.ok((await add(W.t.drv1, { ...base, category: 'snacks' })).body.error.fields.category);
      for (const amount of [0, -5, 'abc', '']) assert.ok((await add(W.t.drv1, { ...base, amount })).body.error.fields.amount, String(amount));
      assert.match((await add(W.t.drv1, { ...base, amount: 99999999 })).body.error.fields.amount, /extra zero/);
      assert.match((await add(W.t.drv1, { ...base, category: 'other' })).body.error.fields.notes, /Describe/);
      assert.match((await add(W.t.drv1, { ...base, litres: 20 })).body.error.fields.litres, /diesel only/);
      assert.match((await add(W.t.drv1, { ...base, date: inDays(10).toISOString() })).body.error.fields.date, /future/);
      assert.ok((await add(W.t.drv1, { category: 'toll', amount: 1 })).body.error.fields.trip);
      assert.equal((await add(W.t.drv1, { ...base, trip: 'nope' })).status, 400);
    });
    it('only for trips that have started and not been cancelled', async () => {
      const mine = await call('post', '/api/expenses', W.t.acctDel, { trip: E.planned._id, category: 'toll', amount: 1 });
      assert.equal(mine.status, 422);
      assert.match(mine.body.error.message, /started/);
      const c = await add(W.t.acctDel, { trip: E.cancelled._id, category: 'toll', amount: 1 });
      assert.match(c.body.error.message, /cancelled/);
    });
    it('a driver cannot add to someone else\'s trip', async () => {
      assert.equal((await add(W.t.drv1, { trip: E.done._id, category: 'toll', amount: 1 })).status, 404);
    });
    it('drivers get a limited window after completion; accountants do not', async () => {
      const ok = await add(W.t.drv2, { trip: E.done._id, category: 'toll', amount: 200 });
      assert.equal(ok.status, 201, JSON.stringify(ok.body));
      await Trip.updateOne({ _id: E.done._id }, { completedAt: inDays(-10) });
      const late = await add(W.t.drv2, { trip: E.done._id, category: 'toll', amount: 200 });
      assert.equal(late.status, 422);
      assert.match(late.body.error.message, /7 days/);
      assert.equal((await add(W.t.acctDel, { trip: E.done._id, category: 'toll', amount: 200 })).status, 201);
      process.env.DRIVER_EXPENSE_DAYS = '30';
      assert.equal((await add(W.t.drv2, { trip: E.done._id, category: 'toll', amount: 200 })).status, 201);
      delete process.env.DRIVER_EXPENSE_DAYS;
    });
    it('dispatchers can\'t add, accountants and managers can, other branches can\'t', async () => {
      assert.equal((await add(W.t.dispDel, { trip: E.road._id, category: 'toll', amount: 1 })).status, 403);
      assert.equal((await add(W.t.acctDel, { trip: E.road._id, category: 'parking', amount: 80 })).status, 201);
      assert.equal((await add(W.t.mgrDel, { trip: E.road._id, category: 'food', amount: 250 })).status, 201);
      assert.equal((await add(W.t.admin, { trip: E.road._id, category: 'fine', amount: 500 })).status, 201);
      assert.equal((await add(W.t.mgrMum, { trip: E.road._id, category: 'toll', amount: 1 })).status, 404);
    });
  });

  describe('editing: accountant, branch manager and super admin only', () => {
    it('drivers and dispatchers cannot edit, even their own entry', async () => {
      for (const t of [W.t.drv1, W.t.dispDel]) {
        const r = await call('put', `/api/expenses/${E.toll._id}`, t, { amount: 1 });
        assert.equal(r.status, 403);
        assert.equal(r.body.error.code, 'FORBIDDEN');
      }
      assert.equal((await Expense.findById(E.toll._id)).amount, 450);
    });
    it('an accountant corrects the amount; who and what changed is recorded', async () => {
      const r = await call('put', `/api/expenses/${E.toll._id}`, W.t.acctDel, { amount: 520 });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.data.amount, 520);
      assert.equal(r.body.data.editedBy.name, 'Acct Del');
      assert.ok(r.body.data.editedAt);
      assert.equal(r.body.data.createdBy.name, 'Ravi', 'the original author is kept');
      const log = await AuditLog.findOne({ entity: 'Expense', action: 'update' }).sort('-createdAt');
      assert.match(log.summary, /amount 450 -> 520/);
      assert.equal(log.userName, 'Acct Del');
    });
    it('managers and super admins can edit too', async () => {
      assert.equal((await call('put', `/api/expenses/${E.toll._id}`, W.t.mgrDel, { notes: 'Checked against receipt' })).status, 200);
      assert.equal((await call('put', `/api/expenses/${E.toll._id}`, W.t.admin, { amount: 450 })).status, 200);
    });
    it('keeps the rules on edit and cannot move an expense to another trip', async () => {
      let r = await call('put', `/api/expenses/${E.toll._id}`, W.t.acctDel, { amount: -3 });
      assert.ok(r.body.error.fields.amount);
      const plain = await add(W.t.drv1, { trip: E.road._id, category: 'parking', amount: 40 });
      r = await call('put', `/api/expenses/${plain.body.data._id}`, W.t.acctDel, { category: 'other' });
      assert.equal(r.status, 422);
      assert.match(r.body.error.fields.notes, /Describe/, 'switching to "other" needs a description');
      assert.equal((await call('put', `/api/expenses/${plain.body.data._id}`, W.t.acctDel, { category: 'other', notes: 'Parking for the night' })).status, 200);
      r = await call('put', `/api/expenses/${E.diesel._id}`, W.t.acctDel, { category: 'toll' });
      assert.equal(r.status, 200);
      assert.equal(r.body.data.litres ?? null, null, 'litres are dropped when it is no longer diesel');
      await call('put', `/api/expenses/${E.diesel._id}`, W.t.acctDel, { category: 'diesel', litres: 105 });
      await call('put', `/api/expenses/${E.diesel._id}`, W.t.acctDel, { trip: E.planned._id, amount: 9800 });
      assert.equal(String((await Expense.findById(E.diesel._id)).trip), String(E.road._id));
    });
    it('other branches cannot touch it', async () => {
      assert.equal((await call('put', `/api/expenses/${E.toll._id}`, W.t.mgrMum, { amount: 1 })).status, 404);
      assert.equal((await call('put', `/api/expenses/${new mongoose.Types.ObjectId()}`, W.t.acctDel, { amount: 1 })).status, 404);
      assert.equal((await call('put', '/api/expenses/not-an-id', W.t.acctDel, { amount: 1 })).status, 400);
    });
  });

  describe('deleting: branch manager and super admin only', () => {
    it('accountants, dispatchers and drivers cannot delete', async () => {
      for (const t of [W.t.acctDel, W.t.dispDel, W.t.drv1]) {
        const r = await call('delete', `/api/expenses/${E.other._id}`, t);
        assert.equal(r.status, 403);
      }
      assert.ok(await Expense.findById(E.other._id));
    });
    it('another branch\'s manager cannot delete it', async () => {
      assert.equal((await call('delete', `/api/expenses/${E.other._id}`, W.t.mgrMum)).status, 404);
    });
    it('the branch manager and the super admin can, and it is logged', async () => {
      assert.equal((await call('delete', `/api/expenses/${E.other._id}`, W.t.mgrDel)).status, 200);
      assert.equal(await Expense.findById(E.other._id), null);
      const extra = await add(W.t.drv1, { trip: E.road._id, category: 'toll', amount: 60 });
      assert.equal((await call('delete', `/api/expenses/${extra.body.data._id}`, W.t.admin)).status, 200);
      const logs = await AuditLog.find({ entity: 'Expense', action: 'delete' });
      assert.equal(logs.length, 2);
      const byManager = logs.find((l) => /other Rs\. 300/.test(l.summary));
      assert.equal(byManager.userName, 'Mgr Del');
      assert.equal(logs.find((l) => /toll Rs\. 60/.test(l.summary)).userName, 'Admin');
    });
    it('a trip with expenses cannot be deleted until they are removed', async () => {
      await setStatus(E.road._id, 'completed', W.t.dispDel);
      const r = await call('delete', `/api/trips/${E.road._id}`, W.t.mgrDel);
      assert.equal(r.status, 409);
      assert.match(r.body.error.message, /expense record/);
    });
  });

  describe('viewing', () => {
    it('drivers see only expenses on their own trips', async () => {
      const mine = await call('get', '/api/expenses', W.t.drv1);
      assert.equal(mine.status, 200);
      assert.ok(mine.body.data.length >= 3);
      assert.ok(mine.body.data.every((x) => x.trip.tripNo === E.road.tripNo));
      const theirs = await call('get', '/api/expenses', W.t.drv2);
      assert.ok(theirs.body.data.every((x) => x.trip.tripNo === E.done.tripNo));
    });
    it('dispatchers and accountants can read; other branches see nothing', async () => {
      assert.equal((await call('get', '/api/expenses', W.t.dispDel)).status, 200);
      assert.ok((await call('get', '/api/expenses', W.t.acctDel)).body.data.length >= 5);
      assert.equal((await call('get', '/api/expenses', W.t.mgrMum)).body.data.length, 0);
      assert.equal((await call('get', '/api/expenses')).status, 401);
    });
    it('filters by trip, category, date and text, with totals', async () => {
      const all = await call('get', `/api/expenses?trip=${E.road._id}`, W.t.mgrDel);
      assert.equal(all.body.meta.count, all.body.data.length);
      const sum = all.body.data.reduce((s, x) => s + x.amount, 0);
      assert.equal(all.body.meta.total, Math.round(sum * 100) / 100);
      assert.equal(all.body.meta.byCategory.diesel, 9800);
      const diesel = await call('get', `/api/expenses?trip=${E.road._id}&category=diesel`, W.t.mgrDel);
      assert.deepEqual(diesel.body.data.map((x) => x.category), ['diesel']);
      assert.equal((await call('get', '/api/expenses?category=snacks', W.t.mgrDel)).status, 400);
      assert.equal((await call('get', '/api/expenses?from=nonsense', W.t.mgrDel)).status, 400);
      const future = await call('get', `/api/expenses?from=${inDays(3).toISOString()}`, W.t.mgrDel);
      assert.equal(future.body.data.length, 0);
      const text = await call('get', '/api/expenses?q=neemrana', W.t.mgrDel);
      assert.equal(text.body.data.length, 1);
    });
    it('super admins can narrow to one branch', async () => {
      assert.ok((await call('get', '/api/expenses', W.t.admin)).body.data.length >= 5);
      assert.equal((await call('get', '/api/expenses', W.t.admin, undefined, { 'X-Branch': String(W.mum._id) })).body.data.length, 0);
    });
    it('trip lists show expense totals to the owning branch only', async () => {
      const own = (await call('get', '/api/trips', W.t.acctDel)).body.data.find((t) => t._id === E.road._id);
      assert.ok(own.expenseTotal > 0);
      const incoming = await newTrip({ destinationBranch: String(W.mum._id) });
      await Expense.create({ branch: W.del._id, trip: incoming._id, category: 'toll', amount: 99 });
      const seenByMumbai = (await call('get', '/api/trips', W.t.dispMum)).body.data.find((t) => t._id === incoming._id);
      assert.ok(seenByMumbai, 'the destination branch still sees the trip');
      assert.equal(seenByMumbai.expenseTotal, undefined, 'but not its costs');
    });
    it('the dashboard shows 30-day expenses to roles that may read them', async () => {
      assert.ok((await call('get', '/api/dashboard', W.t.mgrDel)).body.data.expenses30 > 0);
      assert.ok((await call('get', '/api/dashboard', W.t.acctDel)).body.data.expenses30 > 0);
    });
  });
});
