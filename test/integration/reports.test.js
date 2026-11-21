// Pagination (10 per page), expenses grouped by trip, and the report downloads (Excel and CSV).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import Vehicle from '../../src/models/Vehicle.js';
import Trip from '../../src/models/Trip.js';
import Expense from '../../src/models/Expense.js';
import Customer from '../../src/models/Customer.js';
import AuditLog from '../../src/models/AuditLog.js';
import User from '../../src/models/User.js';
import { DATASETS } from '../../src/reports/datasets.js';
import { mongoose, W, call, newTrip, buildWorld, connectTestDb, binary, inDays } from './world.js';

const skipReason = await connectTestDb('reports');
const today = new Date().toISOString().slice(0, 10);
const download = (url, token, headers) => call('get', url, token, undefined, headers).buffer(true).parse(binary);
const sheetOf = async (buf, name) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return name ? wb.getWorksheet(name) : wb;
};
const rowsOf = (ws) => { const out = []; ws.eachRow((row, n) => { if (n > 1) out.push(row.values.slice(1)); }); return out; };
const ids = (r) => r.body.data.map((x) => x._id);
const T = { trips: [] };

describe('pagination, trip-grouped expenses and reports', { skip: skipReason }, () => {
  before(async () => {
    await buildWorld();
    await Vehicle.create(Array.from({ length: 25 }, (_, i) => ({ branch: W.del._id, plate: `P${String(i + 1).padStart(2, '0')}`, capacityKg: 1000 + i })));
    for (let i = 1; i <= 12; i++) {
      const t = await newTrip({ origin: `City${i}`, destination: 'Hub', fare: i * 1000, vehicle: i % 2 ? String(W.v1._id) : undefined, driver: i % 2 ? String(W.d1._id) : undefined });
      T.trips.push(t);
      await Expense.create({ branch: W.del._id, trip: t._id, driver: i % 2 ? W.d1._id : W.d2._id, category: 'diesel', amount: 100 * i, litres: 10, date: inDays(-i) });
      await Expense.create({ branch: W.del._id, trip: t._id, driver: i % 2 ? W.d1._id : W.d2._id, category: 'toll', amount: 50, date: inDays(-i) });
    }
    await Customer.create({ name: '=HYPERLINK("http://evil.test","click")', email: 'a@b.test' });
  });
  after(async () => { await mongoose.disconnect(); });

  describe('pagination (10 per page)', () => {
    it('returns pages of 10 with totals, no duplicates and no gaps', async () => {
      const everything = await call('get', '/api/vehicles', W.t.mgrDel);
      assert.equal(everything.body.meta, undefined, 'no page parameter means the full list');
      const total = everything.body.data.length;
      assert.equal(total, 28);
      const seen = [];
      for (const page of [1, 2, 3]) {
        const r = await call('get', `/api/vehicles?page=${page}`, W.t.mgrDel);
        assert.equal(r.status, 200);
        assert.deepEqual(r.body.meta, { page, limit: 10, total, pages: 3 });
        assert.equal(r.body.data.length, page < 3 ? 10 : 8);
        seen.push(...ids(r));
      }
      assert.equal(new Set(seen).size, total, 'every record appears exactly once');
      assert.deepEqual(seen.slice().sort(), ids(everything).slice().sort());
    });
    it('a page past the end is empty, bad values are refused', async () => {
      const r = await call('get', '/api/vehicles?page=9', W.t.mgrDel);
      assert.equal(r.body.data.length, 0);
      assert.equal(r.body.meta.pages, 3);
      assert.equal((await call('get', '/api/vehicles?page=0', W.t.mgrDel)).status, 400);
      assert.equal((await call('get', '/api/vehicles?page=x', W.t.mgrDel)).status, 400);
      assert.equal((await call('get', '/api/vehicles?page=1&limit=500', W.t.mgrDel)).status, 400);
      assert.equal((await call('get', '/api/vehicles?page=1&limit=5', W.t.mgrDel)).body.data.length, 5);
    });
    it('works together with search and filters, and keeps branch isolation', async () => {
      const r = await call('get', '/api/vehicles?page=1&q=P0', W.t.mgrDel);
      assert.equal(r.body.meta.total, 9);
      assert.ok(r.body.data.every((v) => v.plate.startsWith('P0')));
      assert.equal((await call('get', '/api/vehicles?page=1', W.t.mgrMum)).body.meta.total, 1);
    });
    it('trips, users, audit log and customers page too', async () => {
      const trips = await call('get', '/api/trips?page=1', W.t.mgrDel);
      assert.equal(trips.body.data.length, 10);
      assert.equal(trips.body.meta.total, 12);
      assert.equal(typeof trips.body.data[0].expenseTotal, 'number', 'totals are attached to the page');
      assert.equal((await call('get', '/api/trips?page=2', W.t.mgrDel)).body.data.length, 2);
      const users = await call('get', '/api/users?page=1&limit=3', W.t.admin);
      assert.equal(users.body.data.length, 3);
      assert.equal(users.body.meta.total, (await call('get', '/api/users', W.t.admin)).body.data.length);
      const audit = await call('get', '/api/audit?page=1', W.t.mgrDel);
      assert.ok(audit.body.data.length <= 10 && audit.body.meta.total >= 12);
      assert.equal((await call('get', '/api/customers?page=1', W.t.dispDel)).body.meta.total, 1);
      assert.equal((await call('get', '/api/branches?page=1', W.t.admin)).body.meta.total, 2);
      assert.equal((await call('get', '/api/branches?page=1', W.t.mgrDel)).body.meta, undefined, 'the branch directory for other roles is small and unpaged');
    });
  });

  describe('expenses grouped by trip', () => {
    it('one row per trip with totals, a category breakdown, fare and profit', async () => {
      const r = await call('get', '/api/expenses/by-trip', W.t.mgrDel);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.data.length, 10);
      assert.deepEqual([r.body.meta.page, r.body.meta.total, r.body.meta.pages], [1, 12, 2]);
      const first = r.body.data[0];
      assert.equal(first.trip.tripNo, T.trips[0].tripNo, 'most recent expenses first');
      assert.deepEqual([first.expenseCount, first.total, first.byCategory, first.litres], [2, 150, { diesel: 100, toll: 50 }, 10]);
      assert.deepEqual([first.fare, first.profit], [1000, 850]);
      assert.ok(!r.body.data.some((g) => g.trip.tripNo === T.trips[11].tripNo), 'the oldest expenses are on the next page');
      const p2 = await call('get', '/api/expenses/by-trip?page=2', W.t.mgrDel);
      assert.equal(p2.body.data.find((g) => g.trip.tripNo === T.trips[11].tripNo)?.total, 1250);
    });
    it('totals cover every page, not just the visible one', async () => {
      const r = await call('get', '/api/expenses/by-trip', W.t.mgrDel);
      const sum = [...Array(12).keys()].reduce((s, i) => s + 100 * (i + 1) + 50, 0);
      assert.equal(r.body.meta.grandTotal, sum);
      assert.deepEqual(r.body.meta.byCategory, { diesel: 7800, toll: 600 });
      const p2 = await call('get', '/api/expenses/by-trip?page=2', W.t.mgrDel);
      assert.equal(p2.body.data.length, 2);
      const all = [...r.body.data, ...p2.body.data].map((g) => g.trip._id);
      assert.equal(new Set(all).size, 12);
    });
    it('filters by search text, category, trip and date', async () => {
      assert.equal((await call('get', '/api/expenses/by-trip?q=city3', W.t.mgrDel)).body.meta.total, 1);
      const toll = await call('get', '/api/expenses/by-trip?category=toll', W.t.mgrDel);
      assert.equal(toll.body.meta.grandTotal, 600);
      assert.deepEqual(Object.keys(toll.body.data[0].byCategory), ['toll']);
      assert.equal((await call('get', `/api/expenses/by-trip?trip=${T.trips[4]._id}`, W.t.mgrDel)).body.meta.total, 1);
      assert.equal((await call('get', `/api/expenses/by-trip?from=${inDays(-3).toISOString().slice(0, 10)}`, W.t.mgrDel)).body.meta.total, 3);
      assert.equal((await call('get', '/api/expenses/by-trip?category=snacks', W.t.mgrDel)).status, 400);
      assert.equal((await call('get', '/api/expenses/by-trip?page=0', W.t.mgrDel)).status, 400);
    });
    it('drivers see only their own trips and never fares or profit; other branches see nothing', async () => {
      const mine = await call('get', '/api/expenses/by-trip', W.t.drv1);
      assert.equal(mine.body.meta.total, 6, 'Ravi drove the six odd-numbered trips');
      assert.ok(mine.body.data.every((g) => g.fare === undefined && g.profit === undefined));
      assert.equal((await call('get', '/api/expenses/by-trip', W.t.mgrMum)).body.meta.total, 0);
      assert.equal((await call('get', '/api/expenses/by-trip', W.t.admin)).body.meta.total, 12);
    });
    it('the individual lines of one trip are still available', async () => {
      const r = await call('get', `/api/expenses?trip=${T.trips[0]._id}`, W.t.acctDel);
      assert.deepEqual(r.body.data.map((e) => e.category).sort(), ['diesel', 'toll']);
    });
  });

  describe('reports', () => {
    const keysFor = async (token) => (await call('get', '/api/reports', token)).body.data.map((d) => d.key);
    it('lists only what each role may export', async () => {
      const all = DATASETS.map((d) => d.key);
      assert.deepEqual((await keysFor(W.t.admin)).sort(), all.slice().sort());
      const mgr = await keysFor(W.t.mgrDel);
      assert.ok(!mgr.includes('branches') && mgr.includes('users') && mgr.includes('audit') && mgr.includes('invoices'));
      const acct = await keysFor(W.t.acctDel);
      assert.ok(acct.includes('invoices') && acct.includes('expenses') && !acct.includes('users') && !acct.includes('audit'));
      const disp = await keysFor(W.t.dispDel);
      assert.ok(disp.includes('trips') && !disp.includes('invoices') && !disp.includes('users'));
      assert.equal((await call('get', '/api/reports', W.t.drv1)).status, 403);
      assert.equal((await call('get', '/api/reports')).status, 401);
    });
    it('downloads a real Excel file with the right headers and every row', async () => {
      const r = await download('/api/reports/trips', W.t.mgrDel);
      assert.equal(r.status, 200);
      assert.match(r.headers['content-type'], /spreadsheetml/);
      assert.equal(r.headers['content-disposition'], `attachment; filename="haulwise-trips-${today}.xlsx"`);
      const ws = await sheetOf(r.body, 'Trips');
      const header = ws.getRow(1).values.slice(1);
      assert.deepEqual(header.slice(0, 3), ['Trip no', 'Branch', 'To branch']);
      const rows = rowsOf(ws);
      assert.equal(rows.length, 12, 'all trips, not just one page of 10');
      assert.equal(Number(r.headers['x-report-rows']), 12);
      const cell = (name) => header.indexOf(name);
      const first = rows.find((x) => x[0] === T.trips[0].tripNo);
      assert.equal(first[cell('Fare (₹)')], 1000);
      assert.equal(first[cell('Expenses (₹)')], 150);
      assert.equal(ws.getRow(1).font.bold, true);
    });
    it('downloads CSV with a BOM, and neutralises formula injection', async () => {
      const r = await download('/api/reports/customers?format=csv', W.t.dispDel);
      assert.equal(r.status, 200);
      assert.match(r.headers['content-type'], /text\/csv/);
      const text = r.body.toString('utf8');
      assert.equal(text.charCodeAt(0), 0xfeff);
      assert.ok(text.includes(`"'=HYPERLINK(""http://evil.test"",""click"")"`), 'the leading = is defused');
      assert.ok(!/^=HYPERLINK/m.test(text));
    });
    it('exports what you filtered', async () => {
      const planned = rowsOf(await sheetOf((await download('/api/reports/trips?status=planned', W.t.mgrDel)).body, 'Trips'));
      assert.equal(planned.length, 12);
      assert.equal(rowsOf(await sheetOf((await download('/api/reports/trips?status=completed', W.t.mgrDel)).body, 'Trips')).length, 0);
      assert.equal(rowsOf(await sheetOf((await download('/api/reports/trips?q=city7', W.t.mgrDel)).body, 'Trips')).length, 1);
      assert.equal(rowsOf(await sheetOf((await download(`/api/reports/trips?from=${inDays(30).toISOString().slice(0, 10)}`, W.t.mgrDel)).body, 'Trips')).length, 0);
      assert.equal((await download('/api/reports/trips?from=nonsense', W.t.mgrDel)).status, 400);
    });
    it('only ever contains the caller\'s branch', async () => {
      const mum = rowsOf(await sheetOf((await download('/api/reports/trips', W.t.mgrMum)).body, 'Trips'));
      assert.equal(mum.length, 0);
      const veh = rowsOf(await sheetOf((await download('/api/reports/vehicles', W.t.mgrMum)).body, 'Vehicles'));
      assert.deepEqual(veh.map((r) => r[0]), ['MH01']);
      const adminMum = rowsOf(await sheetOf((await download('/api/reports/vehicles', W.t.admin, { 'X-Branch': String(W.mum._id) })).body, 'Vehicles'));
      assert.equal(adminMum.length, 1);
    });
    it('trip costs match the grouped screen, and expense lines match the database', async () => {
      const costs = await sheetOf((await download('/api/reports/trip-costs', W.t.acctDel)).body, 'Trip costs');
      const header = costs.getRow(1).values.slice(1);
      const rows = rowsOf(costs);
      assert.equal(rows.length, 12);
      assert.equal(rows.reduce((s, r) => s + r[header.indexOf('Total expenses (₹)')], 0), 8400);
      assert.equal(rows.reduce((s, r) => s + r[header.indexOf('Profit (₹)')], 0), 78000 - 8400);
      const lines = rowsOf(await sheetOf((await download('/api/reports/expenses', W.t.acctDel)).body, 'Expense lines'));
      assert.equal(lines.length, await Expense.countDocuments({ branch: W.del._id }));
    });
    it('the users report never includes passwords, and managers do not see super admins', async () => {
      const ws = await sheetOf((await download('/api/reports/users', W.t.mgrDel)).body, 'Users');
      const header = ws.getRow(1).values.slice(1).join('|');
      assert.ok(!/password|hash/i.test(header));
      const text = JSON.stringify(rowsOf(ws));
      assert.ok(!text.includes('admin@t.test'));
      assert.ok(!text.includes((await User.findOne({ email: 'mgr.del@t.test' }).select('+password')).password));
    });
    it('"all reports" is one workbook with a sheet per report the role may see', async () => {
      const r = await download('/api/reports/all', W.t.acctDel);
      assert.equal(r.status, 200);
      assert.equal(r.headers['content-disposition'], `attachment; filename="haulwise-all-reports-${today}.xlsx"`);
      const wb = await sheetOf(r.body);
      const wanted = DATASETS.filter((d) => ['trips', 'trip-costs', 'expenses', 'invoices', 'drivers', 'vehicles', 'customers', 'maintenance', 'rates', 'alerts'].includes(d.key)).map((d) => d.label);
      assert.deepEqual(wb.worksheets.map((w) => w.name).sort(), wanted.sort());
      assert.equal((await download('/api/reports/all?format=csv', W.t.acctDel)).status, 400);
      const admin = await sheetOf((await download('/api/reports/all', W.t.admin)).body);
      assert.equal(admin.worksheets.length, DATASETS.length);
    });
    it('refuses what a role may not export, unknown reports and bad formats', async () => {
      const r = await download('/api/reports/branches', W.t.mgrDel);
      assert.equal(r.status, 403);
      assert.equal((await download('/api/reports/users', W.t.acctDel)).status, 403);
      assert.equal((await download('/api/reports/trips', W.t.drv1)).status, 403);
      assert.equal((await download('/api/reports/nope', W.t.admin)).status, 404);
      assert.equal((await download('/api/reports/trips?format=pdf', W.t.admin)).status, 400);
      assert.equal((await download('/api/reports/trips')).status, 401);
    });
    it('records every export in the audit log', async () => {
      const log = await AuditLog.find({ action: 'export' });
      assert.ok(log.length >= 6);
      assert.ok(log.some((l) => /^trips: 12 rows \(xlsx\)$/.test(l.summary) && l.userName === 'Mgr Del'));
      assert.ok(log.some((l) => /^all reports: \d+ sheets/.test(l.summary)));
    });
  });
});
