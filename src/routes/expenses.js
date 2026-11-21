import { Router } from 'express';
import Expense from '../models/Expense.js';
import Trip from '../models/Trip.js';
import { ensure, need } from '../middleware/auth.js';
import { badRequest, forbidden, invalid, notFound, rule } from '../utils/errors.js';
import { assertId, scopeFilter } from '../utils/scope.js';
import { audit } from '../utils/audit.js';
import { parseExpense } from '../utils/expense.js';
import { expenseFilter, tripCostGroups } from '../services/expenses.js';
import { pageMeta, pageParams } from '../utils/paginate.js';
import { round2 } from '../utils/gst.js';

// Who may do what:
//   add     drivers (their own trips), accountants, branch managers, super admins
//   edit    accountants, branch managers, super admins
//   delete  branch managers, super admins
//   view    the same roles plus dispatchers; drivers see only their own trips' expenses
const r = Router();
const POP = [{ path: 'trip', select: 'tripNo origin destination status' }, { path: 'createdBy', select: 'name role' }, { path: 'editedBy', select: 'name' }, { path: 'branch', select: 'name code' }];
const rupees = (n) => `Rs. ${Number(n).toLocaleString('en-IN')}`;

// Individual expense lines (used inside a trip, and for exports). Totals cover the whole filtered set.
r.get('/', need('expenses:read'), async (req, res) => {
  const rows = await Expense.find(expenseFilter(req, req.query)).populate(POP).sort('-date _id').limit(500);
  const byCategory = {};
  let total = 0;
  for (const e of rows) { total += e.amount; byCategory[e.category] = round2((byCategory[e.category] || 0) + e.amount); }
  res.json({ data: rows, meta: { count: rows.length, total: round2(total), byCategory } });
});

// Expenses grouped by trip, 10 trips per page: totals, category breakdown, fare and profit (not for drivers).
r.get('/by-trip', need('expenses:read'), async (req, res) => {
  const all = await tripCostGroups(req, req.query);
  const pg = pageParams(req.query) ?? { page: 1, limit: 10, skip: 0 };
  const byCategory = {};
  let grandTotal = 0;
  for (const g of all) {
    grandTotal += g.total;
    for (const [k, v] of Object.entries(g.byCategory)) byCategory[k] = round2((byCategory[k] || 0) + v);
  }
  res.json({ data: all.slice(pg.skip, pg.skip + pg.limit), meta: { ...pageMeta(pg, all.length), grandTotal: round2(grandTotal), byCategory } });
});

r.post('/', async (req, res) => {
  ensure(req, 'expenses:add');
  const { trip: tripId } = req.body;
  if (!tripId) throw invalid({ trip: 'Choose a trip' });
  assertId(tripId, 'Trip');

  const isDriver = req.user.role === 'driver';
  if (isDriver && !req.user.driverProfile) throw forbidden('Your login is not linked to a driver record. Ask your manager to fix this.');
  const trip = await Trip.findOne({ _id: tripId, ...(isDriver ? { driver: req.user.driverProfile } : scopeFilter(req)) });
  if (!trip) throw notFound('Trip');
  if (!['in-transit', 'completed'].includes(trip.status)) {
    throw rule(trip.status === 'planned' ? 'Expenses can be added once the trip has started' : "Expenses can't be added to a cancelled trip", { trip: `Trip is ${trip.status}` });
  }
  if (isDriver && trip.status === 'completed') {
    const days = Number(process.env.DRIVER_EXPENSE_DAYS || 7);
    const doneAt = (trip.completedAt || trip.updatedAt).getTime();
    if (Date.now() - doneAt > days * 864e5) {
      throw rule(`Drivers can add expenses up to ${days} days after a trip is completed. Ask your accountant to add this one.`, { trip: 'Too long after completion' });
    }
  }

  const data = parseExpense(req.body, { tripStart: trip.scheduledAt });
  const e = await Expense.create({ ...data, date: data.date ?? new Date(), branch: trip.branch, trip: trip._id, driver: trip.driver, vehicle: trip.vehicle, createdBy: req.user._id });
  await audit(req, 'create', 'Expense', e, `${trip.tripNo} ${e.category} ${rupees(e.amount)}`);
  res.status(201).json({ data: await Expense.findById(e._id).populate(POP) });
});

r.put('/:id', need('expenses:write'), async (req, res) => {
  assertId(req.params.id, 'Expense');
  const e = await Expense.findOne({ _id: req.params.id, ...scopeFilter(req) });
  if (!e) throw notFound('Expense');
  const trip = await Trip.findById(e.trip).select('tripNo scheduledAt');
  const data = parseExpense(req.body, { partial: true, existing: e, tripStart: trip?.scheduledAt });

  const changes = Object.entries(data)
    .filter(([k, v]) => String(e[k] ?? '') !== String(v ?? ''))
    .map(([k, v]) => `${k} ${k === 'date' ? new Date(e[k]).toISOString().slice(0, 10) : e[k] ?? '-'} -> ${k === 'date' ? v.toISOString().slice(0, 10) : v ?? '-'}`);
  e.set(data);
  e.editedBy = req.user._id;
  e.editedAt = new Date();
  await e.save();
  await audit(req, 'update', 'Expense', e, `${trip?.tripNo ?? ''}: ${changes.join(', ') || 'no change'}`);
  res.json({ data: await Expense.findById(e._id).populate(POP) });
});

r.delete('/:id', need('expenses:delete'), async (req, res) => {
  assertId(req.params.id, 'Expense');
  const e = await Expense.findOne({ _id: req.params.id, ...scopeFilter(req) });
  if (!e) throw notFound('Expense');
  const trip = await Trip.findById(e.trip).select('tripNo');
  await e.deleteOne();
  await audit(req, 'delete', 'Expense', e, `${trip?.tripNo ?? ''} ${e.category} ${rupees(e.amount)}`);
  res.json({ data: { ok: true } });
});

export default r;
