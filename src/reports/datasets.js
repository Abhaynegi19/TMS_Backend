// Every downloadable report. Each one is limited to what the caller may see, using the same branch rules as the screens.
import Trip from '../models/Trip.js';
import Expense from '../models/Expense.js';
import Driver from '../models/Driver.js';
import Vehicle from '../models/Vehicle.js';
import Customer from '../models/Customer.js';
import MaintenanceLog from '../models/MaintenanceLog.js';
import RateCard from '../models/RateCard.js';
import Branch from '../models/Branch.js';
import User from '../models/User.js';
import AuditLog from '../models/AuditLog.js';
import { activeBranchId, scopeFilter, tripScope, userBranchId } from '../utils/scope.js';
import { can } from '../utils/permissions.js';
import { ROLE_LABELS } from '../utils/permissions.js';
import { STATES } from '../utils/gst.js';
import { CATEGORIES } from '../utils/expense.js';
import { currentAlerts } from '../services/alerts.js';
import { expenseFilter, expenseTotals, parseDay, tripCostGroups } from '../services/expenses.js';

export const MAX_ROWS = 20000;
const rx = (q) => new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
const range = (field, f) => {
  const r = {};
  if (f.from) r.$gte = parseDay(f.from, 'from');
  if (f.to) r.$lte = parseDay(f.to, 'to', true);
  return Object.keys(r).length ? { [field]: r } : {};
};
const search = (keys, q) => (q ? { $or: keys.map((k) => ({ [k]: rx(q) })) } : {});
const cols = (...a) => a.map(([key, header, width = 16, type]) => ({ key, header, width, type }));
const title = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const yes = (b) => (b === false ? 'No' : 'Yes');

export const DATASETS = [
  {
    key: 'trips', label: 'Trips', perm: 'trips:read', description: 'Every trip with route, vehicle, driver, fare, payment status and expense total',
    columns: cols(['tripNo', 'Trip no'], ['branch', 'Branch', 9], ['toBranch', 'To branch', 10], ['customer', 'Customer', 26], ['origin', 'Origin'], ['destination', 'Destination'],
      ['scheduledAt', 'Scheduled', 18, 'datetime'], ['status', 'Status', 12], ['vehicle', 'Vehicle', 14], ['driver', 'Driver', 18], ['distanceKm', 'Distance (km)', 13, 'number'],
      ['cargoWeightKg', 'Cargo (kg)', 11, 'number'], ['fare', 'Fare (₹)', 13, 'money'], ['paymentStatus', 'Payment', 10], ['expenses', 'Expenses (₹)', 14, 'money'],
      ['invoiceNo', 'Invoice no', 16], ['startedAt', 'Started', 18, 'datetime'], ['completedAt', 'Completed', 18, 'datetime']),
    async rows(req, f) {
      const conds = [tripScope(req), range('scheduledAt', f)];
      if (f.status) conds.push({ status: String(f.status) });
      conds.push(search(['tripNo', 'customer', 'origin', 'destination'], f.q));
      const trips = await Trip.find({ $and: conds }).populate('branch destinationBranch vehicle driver').sort('-scheduledAt _id').limit(MAX_ROWS);
      const showCost = can(req.user, 'expenses:read');
      const totals = showCost ? await expenseTotals(trips.map((t) => t._id)) : new Map();
      const mine = req.user.role === 'super_admin' ? null : String(userBranchId(req.user));
      return trips.map((t) => ({
        tripNo: t.tripNo, branch: t.branch?.code, toBranch: t.destinationBranch?.code, customer: t.customer, origin: t.origin, destination: t.destination,
        scheduledAt: t.scheduledAt, status: t.status, vehicle: t.vehicle?.plate, driver: t.driver?.name, distanceKm: t.distanceKm, cargoWeightKg: t.cargoWeightKg,
        fare: t.fare, paymentStatus: t.paymentStatus, expenses: showCost && (!mine || String(t.branch?._id) === mine) ? totals.get(String(t._id)) || 0 : '',
        invoiceNo: t.invoice?.no ?? t.invoiceNo, startedAt: t.startedAt, completedAt: t.completedAt,
      }));
    },
  },
  {
    key: 'trip-costs', label: 'Trip costs', perm: 'expenses:read', description: 'Expenses grouped by trip: each category, the total, the fare and the profit',
    columns: cols(['tripNo', 'Trip no'], ['branch', 'Branch', 9], ['customer', 'Customer', 26], ['route', 'Route', 26], ['status', 'Status', 12], ['vehicle', 'Vehicle', 14], ['driver', 'Driver', 18],
      ...CATEGORIES.map((c) => [c, `${title(c)} (₹)`, 13, 'money']), ['total', 'Total expenses (₹)', 18, 'money'], ['litres', 'Diesel litres', 12, 'number'],
      ['fare', 'Fare (₹)', 13, 'money'], ['profit', 'Profit (₹)', 13, 'money'], ['lastDate', 'Last expense', 14, 'date']),
    async rows(req, f) {
      const groups = await tripCostGroups(req, { trip: f.trip, category: f.category, from: f.from, to: f.to, q: f.q });
      return groups.map((g) => ({
        tripNo: g.trip.tripNo, branch: g.trip.branch?.code, customer: g.trip.customer, route: `${g.trip.origin} to ${g.trip.destination}`, status: g.trip.status,
        vehicle: g.trip.vehicle, driver: g.trip.driver, ...Object.fromEntries(CATEGORIES.map((c) => [c, g.byCategory[c] ?? 0])),
        total: g.total, litres: g.litres, fare: g.fare, profit: g.profit, lastDate: g.lastDate,
      }));
    },
  },
  {
    key: 'expenses', label: 'Expense lines', perm: 'expenses:read', description: 'Every individual expense with its trip, category, amount and who added or changed it',
    columns: cols(['date', 'Date', 13, 'date'], ['tripNo', 'Trip no'], ['branch', 'Branch', 9], ['category', 'Category', 11], ['amount', 'Amount (₹)', 13, 'money'], ['litres', 'Litres', 9, 'number'],
      ['notes', 'Notes', 32], ['addedBy', 'Added by', 18], ['editedBy', 'Last edited by', 18], ['editedAt', 'Edited at', 18, 'datetime']),
    async rows(req, f) {
      const list = await Expense.find(expenseFilter(req, f)).populate('trip', 'tripNo').populate('branch', 'code').populate('createdBy', 'name').populate('editedBy', 'name').sort('-date _id').limit(MAX_ROWS);
      return list.map((e) => ({ date: e.date, tripNo: e.trip?.tripNo, branch: e.branch?.code, category: e.category, amount: e.amount, litres: e.litres, notes: e.notes, addedBy: e.createdBy?.name, editedBy: e.editedBy?.name, editedAt: e.editedAt }));
    },
  },
  {
    key: 'invoices', label: 'GST invoices', perm: 'invoices:read', description: 'Register of issued invoices with the GST split, for your accountant',
    columns: cols(['no', 'Invoice no'], ['date', 'Invoice date', 13, 'date'], ['dueDate', 'Due date', 13, 'date'], ['tripNo', 'Trip no'], ['customer', 'Customer', 26], ['gstin', 'Customer GSTIN', 18],
      ['supply', 'Place of supply', 18], ['taxable', 'Taxable value (₹)', 17, 'money'], ['cgst', 'CGST (₹)', 12, 'money'], ['sgst', 'SGST (₹)', 12, 'money'], ['igst', 'IGST (₹)', 12, 'money'],
      ['rate', 'GST rate (%)', 12, 'number'], ['total', 'Invoice total (₹)', 17, 'money'], ['payment', 'Payment', 10], ['branch', 'Branch', 9]),
    async rows(req, f) {
      const filter = { ...scopeFilter(req), 'invoice.no': { $exists: true }, ...range('invoicedAt', f), ...search(['customer', 'invoiceNo', 'tripNo'], f.q) };
      const list = await Trip.find(filter).populate('branch', 'code').sort('-invoicedAt _id').limit(MAX_ROWS);
      return list.map((t) => ({
        no: t.invoice.no, date: t.invoice.date, dueDate: t.invoice.dueDate, tripNo: t.tripNo, customer: t.invoice.buyer?.name, gstin: t.invoice.buyer?.gstin,
        supply: STATES[t.invoice.placeOfSupplyCode] || '', taxable: t.invoice.taxable, cgst: t.invoice.cgst, sgst: t.invoice.sgst, igst: t.invoice.igst, rate: t.invoice.rate,
        total: t.invoice.total, payment: t.paymentStatus, branch: t.branch?.code,
      }));
    },
  },
  {
    key: 'drivers', label: 'Drivers', perm: 'drivers:read', description: 'Drivers with phone, license number and expiry, and status',
    columns: cols(['name', 'Name', 22], ['phone', 'Phone', 14], ['licenseNo', 'License no', 18], ['licenseExpiry', 'License expiry', 14, 'date'], ['status', 'Status', 11], ['branch', 'Branch', 9]),
    async rows(req, f) {
      const list = await Driver.find({ ...scopeFilter(req), ...(f.status ? { status: String(f.status) } : {}), ...search(['name', 'phone', 'licenseNo'], f.q) }).populate('branch', 'code').sort('name _id').limit(MAX_ROWS);
      return list.map((d) => ({ name: d.name, phone: d.phone, licenseNo: d.licenseNo, licenseExpiry: d.licenseExpiry, status: d.status, branch: d.branch?.code }));
    },
  },
  {
    key: 'vehicles', label: 'Vehicles', perm: 'vehicles:read', description: 'Fleet with capacity, odometer, document expiries and service schedule',
    columns: cols(['plate', 'Plate', 14], ['type', 'Type', 10], ['capacityKg', 'Capacity (kg)', 13, 'number'], ['status', 'Status', 12], ['odometerKm', 'Odometer (km)', 14, 'number'],
      ['insuranceExpiry', 'Insurance expiry', 15, 'date'], ['permitExpiry', 'Permit expiry', 13, 'date'], ['fitnessExpiry', 'Fitness expiry', 13, 'date'], ['pucExpiry', 'PUC expiry', 12, 'date'],
      ['lastService', 'Last service', 13, 'date'], ['serviceIntervalKm', 'Service every (km)', 17, 'number'], ['serviceIntervalDays', 'Service every (days)', 19, 'number'], ['branch', 'Branch', 9]),
    async rows(req, f) {
      const list = await Vehicle.find({ ...scopeFilter(req), ...(f.status ? { status: String(f.status) } : {}), ...search(['plate', 'type'], f.q) }).populate('branch', 'code').sort('plate _id').limit(MAX_ROWS);
      return list.map((v) => ({ ...v.toObject(), branch: v.branch?.code }));
    },
  },
  {
    key: 'customers', label: 'Customers', perm: 'customers:read', description: 'Customer directory with GSTIN, state and payment terms',
    columns: cols(['name', 'Name', 28], ['contactName', 'Contact', 20], ['phone', 'Phone', 14], ['email', 'Email', 26], ['address', 'Address', 30], ['city', 'City', 14], ['state', 'State', 16],
      ['gstin', 'GSTIN', 18], ['paymentTermsDays', 'Terms (days)', 12, 'number'], ['active', 'Active', 8], ['notes', 'Notes', 28]),
    async rows(req, f) {
      const list = await Customer.find({ ...search(['name', 'contactName', 'phone', 'gstin', 'city'], f.q) }).sort('name _id').limit(MAX_ROWS);
      return list.map((c) => ({ ...c.toObject(), state: STATES[c.stateCode] || '', active: yes(c.isActive) }));
    },
  },
  {
    key: 'maintenance', label: 'Maintenance', perm: 'maintenance:read', description: 'Service, repair and tyre history per vehicle with costs',
    columns: cols(['date', 'Date', 13, 'date'], ['vehicle', 'Vehicle', 14], ['type', 'Type', 11], ['odometerKm', 'Odometer (km)', 14, 'number'], ['cost', 'Cost (₹)', 13, 'money'], ['vendor', 'Vendor', 22], ['notes', 'Notes', 32], ['branch', 'Branch', 9]),
    async rows(req, f) {
      const list = await MaintenanceLog.find({ ...scopeFilter(req), ...range('date', f), ...search(['vendor', 'notes'], f.q) }).populate('vehicle', 'plate').populate('branch', 'code').sort('-date _id').limit(MAX_ROWS);
      return list.map((m) => ({ date: m.date, vehicle: m.vehicle?.plate, type: m.type, odometerKm: m.odometerKm, cost: m.cost, vendor: m.vendor, notes: m.notes, branch: m.branch?.code }));
    },
  },
  {
    key: 'rates', label: 'Rate cards', perm: 'rates:read', description: 'Fare rules per customer and vehicle type',
    columns: cols(['name', 'Name', 26], ['customer', 'Customer', 26], ['vehicleType', 'Vehicle type', 12], ['baseFare', 'Base fare (₹)', 14, 'money'], ['perKm', 'Per km (₹)', 12, 'money'], ['perTonne', 'Per tonne (₹)', 14, 'money'], ['minFare', 'Minimum (₹)', 13, 'money'], ['active', 'Active', 8]),
    async rows(req, f) {
      const list = await RateCard.find({ ...search(['name'], f.q) }).populate('customer', 'name').sort('name _id').limit(MAX_ROWS);
      return list.map((c) => ({ ...c.toObject(), customer: c.customer?.name || 'All customers', active: yes(c.isActive) }));
    },
  },
  {
    key: 'alerts', label: 'Alerts', perm: 'alerts:read', description: 'Documents and services that are overdue or due within 30 days',
    columns: cols(['status', 'Status', 10], ['branch', 'Branch', 9], ['label', 'What', 28], ['subject', 'For', 18], ['dueOn', 'Due date', 13, 'date'], ['days', 'Days left', 10, 'number'], ['remainingKm', 'Km left', 10, 'number']),
    async rows(req) {
      const list = await currentAlerts({ branchId: activeBranchId(req) });
      return list.map((a) => ({ status: { expired: 'Overdue', soon: 'Soon', upcoming: 'Upcoming' }[a.severity], branch: a.branch?.code, label: a.label, subject: a.subject, dueOn: a.dueOn, days: a.days, remainingKm: a.remainingKm }));
    },
  },
  {
    key: 'branches', label: 'Branches', perm: 'branches:write', description: 'Branch directory with GST registration',
    columns: cols(['code', 'Code', 8], ['name', 'Name', 24], ['city', 'City', 16], ['address', 'Address', 30], ['phone', 'Phone', 14], ['email', 'Email', 26], ['gstin', 'GSTIN', 18], ['state', 'State', 16], ['active', 'Active', 8]),
    async rows(req, f) {
      const list = await Branch.find({ ...search(['name', 'code', 'city'], f.q) }).sort('name _id').limit(MAX_ROWS);
      return list.map((b) => ({ ...b.toObject(), state: STATES[b.stateCode] || '', active: yes(b.isActive) }));
    },
  },
  {
    key: 'users', label: 'Users', perm: 'users:read', description: 'People with access, their roles and last sign-in (never passwords)',
    columns: cols(['name', 'Name', 22], ['email', 'Email', 28], ['role', 'Role', 16], ['branch', 'Branch', 9], ['driver', 'Driver record', 18], ['active', 'Active', 8], ['lastLoginAt', 'Last sign-in', 18, 'datetime']),
    async rows(req, f) {
      const filter = { ...scopeFilter(req), ...search(['name', 'email'], f.q) };
      if (req.user.role !== 'super_admin') filter.role = { $ne: 'super_admin' };
      const list = await User.find(filter).populate('branch', 'code').populate('driverProfile', 'name').sort('name _id').limit(MAX_ROWS);
      return list.map((u) => ({ name: u.name, email: u.email, role: ROLE_LABELS[u.role], branch: u.branch?.code, driver: u.driverProfile?.name, active: yes(u.isActive), lastLoginAt: u.lastLoginAt }));
    },
  },
  {
    key: 'audit', label: 'Audit log', perm: 'audit:read', description: 'Who did what and when',
    columns: cols(['createdAt', 'When', 18, 'datetime'], ['who', 'Who', 20], ['role', 'Role', 16], ['action', 'Action', 12], ['entity', 'Record', 18], ['summary', 'Details', 44], ['branch', 'Branch', 9]),
    async rows(req, f) {
      const list = await AuditLog.find({ ...scopeFilter(req), ...range('createdAt', f), ...(f.q ? { summary: rx(f.q) } : {}) }).populate('branch', 'code').sort('-createdAt _id').limit(MAX_ROWS);
      return list.map((a) => ({ createdAt: a.createdAt, who: a.userName, role: ROLE_LABELS[a.role] || a.role, action: a.action, entity: a.entity, summary: a.summary, branch: a.branch?.code }));
    },
  },
];
