import { Router } from 'express';
import Vehicle from '../models/Vehicle.js';
import Driver from '../models/Driver.js';
import Trip from '../models/Trip.js';
import Branch from '../models/Branch.js';
import Expense from '../models/Expense.js';
import { can } from '../utils/permissions.js';
import { need } from '../middleware/auth.js';
import { scopeFilter, selectedBranch, tripScope } from '../utils/scope.js';

const r = Router();
const toMap = (a) => Object.fromEntries(a.map((x) => [x._id, x.n]));
const group = (M, match) => M.aggregate([{ $match: match }, { $group: { _id: '$status', n: { $sum: 1 } } }]);

r.get('/', need('dashboard:read'), async (req, res) => {
  const own = scopeFilter(req);
  const visibleTrips = tripScope(req);
  const since = new Date(); since.setMonth(since.getMonth() - 5, 1); since.setHours(0, 0, 0, 0);
  const monthStarts = Array.from({ length: 7 }, (_, i) => new Date(since.getFullYear(), since.getMonth() + i, 1));
  const soon = new Date(Date.now() + 30 * 864e5);

  const [v, d, t, fin, monthly, upcoming, expiring, spend] = await Promise.all([
    group(Vehicle, own), group(Driver, own), group(Trip, visibleTrips),
    Trip.aggregate([
      { $match: { ...own, status: 'completed' } },
      { $group: { _id: '$paymentStatus', total: { $sum: '$fare' }, km: { $sum: '$distanceKm' } } },
    ]),
    Promise.all(monthStarts.slice(0, 6).map((s, i) => Trip.countDocuments({ ...own, scheduledAt: { $gte: s, $lt: monthStarts[i + 1] } }))),
    Trip.find({ ...visibleTrips, status: 'planned', scheduledAt: { $gte: new Date() } }).sort('scheduledAt').limit(5).populate('vehicle driver branch'),
    Driver.find({ ...own, licenseExpiry: { $lte: soon } }).sort('licenseExpiry').limit(5).select('name licenseExpiry branch').populate('branch', 'code'),
    can(req.user, 'expenses:read')
      ? Expense.aggregate([{ $match: { ...own, date: { $gte: new Date(Date.now() - 30 * 864e5) } } }, { $group: { _id: null, total: { $sum: '$amount' } } }])
      : null,
  ]);

  const money = Object.fromEntries(fin.map((x) => [x._id, x.total]));
  const months = monthStarts.slice(0, 6).map((s, i) => ({ label: s.toLocaleString('en', { month: 'short' }), n: monthly[i] }));

  let byBranch = null;
  if (req.user.role === 'super_admin' && !selectedBranch(req)) {
    const [all, done, branches] = await Promise.all([
      Trip.aggregate([{ $group: { _id: '$branch', trips: { $sum: 1 } } }]),
      Trip.aggregate([{ $match: { status: 'completed' } }, { $group: { _id: '$branch', revenue: { $sum: '$fare' } } }]),
      Branch.find().select('name code'),
    ]);
    byBranch = branches.map((b) => ({
      id: b._id, name: b.name, code: b.code,
      trips: all.find((x) => String(x._id) === String(b._id))?.trips || 0,
      revenue: done.find((x) => String(x._id) === String(b._id))?.revenue || 0,
    }));
  }

  res.json({
    data: {
      vehicles: toMap(v), drivers: toMap(d), trips: toMap(t),
      collected: money.paid || 0, outstanding: (money.unpaid || 0) + (money.partial || 0),
      totalKm: fin.reduce((s, x) => s + x.km, 0), months, upcoming, expiring, byBranch,
      expenses30: spend ? Math.round((spend[0]?.total || 0) * 100) / 100 : null,
    },
  });
});

export default r;
