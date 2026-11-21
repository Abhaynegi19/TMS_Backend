import mongoose from 'mongoose';
import Expense from '../models/Expense.js';
import Trip from '../models/Trip.js';
import { badRequest } from '../utils/errors.js';
import { CATEGORIES } from '../utils/expense.js';
import { round2 } from '../utils/gst.js';
import { assertId, scopeFilter } from '../utils/scope.js';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Total expenses per trip, as a Map of tripId -> amount.
export async function expenseTotals(tripIds) {
  if (!tripIds.length) return new Map();
  const rows = await Expense.aggregate([{ $match: { trip: { $in: tripIds } } }, { $group: { _id: '$trip', total: { $sum: '$amount' } } }]);
  return new Map(rows.map((r) => [String(r._id), round2(r.total)]));
}

export const parseDay = (v, label, endOfDay = false) => {
  const s = String(v);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw badRequest(`"${label}" is not a valid date`);
  return endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(d.getTime() + 864e5 - 1) : d;
};

// Who can see which expenses: drivers their own trips', everyone else their branch's (super admins can narrow with X-Branch).
// cast:true is for aggregations, which do not convert strings to ObjectIds by themselves.
export function expenseFilter(req, { trip, category, from, to, q } = {}, { cast = false } = {}) {
  const filter = req.user.role === 'driver'
    ? (req.user.driverProfile ? { driver: req.user.driverProfile } : { _id: { $in: [] } })
    : scopeFilter(req);
  if (trip) { assertId(trip, 'Trip'); filter.trip = cast ? new mongoose.Types.ObjectId(String(trip)) : trip; }
  if (category) {
    if (!CATEGORIES.includes(String(category))) throw badRequest('Unknown expense category');
    filter.category = String(category);
  }
  const range = {};
  if (from) range.$gte = parseDay(from, 'from');
  if (to) range.$lte = parseDay(to, 'to', true);
  if (Object.keys(range).length) filter.date = range;
  if (q) filter.notes = new RegExp(esc(String(q)), 'i');
  return filter;
}

// One entry per trip that has expenses: totals, a category breakdown, and (for non-drivers) fare and profit.
export async function tripCostGroups(req, query = {}) {
  // Folded in code (rather than a $group pipeline) so it behaves the same on every MongoDB-compatible server.
  const rows = await Expense.find(expenseFilter(req, { ...query, q: undefined })).select('trip category amount litres date').limit(100000).lean();
  const groups = new Map();
  for (const r of rows) {
    const id = String(r.trip);
    const g = groups.get(id) || { count: 0, total: 0, litres: 0, last: null, byCategory: {} };
    g.count += 1; g.total += r.amount; g.litres += r.litres || 0;
    g.byCategory[r.category] = round2((g.byCategory[r.category] || 0) + r.amount);
    if (!g.last || r.date > g.last) g.last = r.date;
    groups.set(id, g);
  }
  const trips = await Trip.find({ _id: { $in: [...groups.keys()] } })
    .select('tripNo origin destination status customer fare scheduledAt branch vehicle driver')
    .populate('branch', 'code name').populate('vehicle', 'plate').populate('driver', 'name');
  const search = String(query.q || '').trim().toLowerCase();
  const hideMoney = req.user.role === 'driver';
  const out = [];
  for (const t of trips) {
    if (search && ![t.tripNo, t.origin, t.destination, t.customer].some((v) => String(v || '').toLowerCase().includes(search))) continue;
    const g = groups.get(String(t._id));
    const total = round2(g.total);
    out.push({
      trip: { _id: t._id, tripNo: t.tripNo, origin: t.origin, destination: t.destination, status: t.status, customer: t.customer, branch: t.branch && { code: t.branch.code }, vehicle: t.vehicle?.plate || null, driver: t.driver?.name || null },
      expenseCount: g.count, total, litres: round2(g.litres), byCategory: g.byCategory, lastDate: g.last,
      ...(hideMoney ? {} : { fare: t.fare, profit: round2((t.fare || 0) - total) }),
    });
  }
  return out.sort((a, b) => new Date(b.lastDate) - new Date(a.lastDate) || a.trip.tripNo.localeCompare(b.trip.tripNo));
}
