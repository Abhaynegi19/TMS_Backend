import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Router } from 'express';
import Trip from '../models/Trip.js';
import Vehicle from '../models/Vehicle.js';
import Driver from '../models/Driver.js';
import Branch from '../models/Branch.js';
import { ensure, need } from '../middleware/auth.js';
import { can } from '../utils/permissions.js';
import { AppError, conflict, forbidden, invalid, notFound, rule } from '../utils/errors.js';
import { assertId, resolveTargetBranch, scopeFilter, tripScope, userBranchId } from '../utils/scope.js';
import Expense from '../models/Expense.js';
import { expenseTotals } from '../services/expenses.js';
import { nextTripNo, nextInvoiceNo } from '../utils/counter.js';
import LocationPing from '../models/LocationPing.js';
import { parseLocation } from '../utils/geo.js';
import { invoiceBuffer } from '../utils/invoicePdf.js';
import Customer from '../models/Customer.js';
import { ensureInvoice } from '../services/invoice.js';
import { parseImage } from '../utils/images.js';
import { mimeOf, readPodFile, removePodFile, removeTripFiles, savePodFile } from '../utils/storage.js';
import { hashToken, publicUrl } from '../utils/links.js';
import { esc as escHtml, sendMail } from '../utils/mailer.js';
import { pageMeta, pageParams } from '../utils/paginate.js';
import { emailError } from '../utils/validators.js';
import { emitLocation, emitTripStatus } from '../realtime.js';
import { audit } from '../utils/audit.js';

const r = Router();
const POP = ['branch', 'destinationBranch', 'vehicle', 'driver', { path: 'customerRef', select: 'name phone city' }];
const WRITABLE = ['customer', 'customerRef', 'origin', 'destination', 'destinationBranch', 'cargo', 'cargoWeightKg', 'scheduledAt', 'vehicle', 'driver', 'distanceKm', 'fare', 'notes'];
const NEXT = { planned: ['in-transit', 'cancelled'], 'in-transit': ['completed', 'cancelled'], completed: [], cancelled: [] };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pick = (b) => Object.fromEntries(WRITABLE.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
const same = (a, b) => String(a ?? '') === String(b ?? '');

const owned = async (req) => {
  assertId(req.params.id, 'Trip');
  const t = await Trip.findOne({ _id: req.params.id, ...scopeFilter(req) });
  if (!t) throw notFound('Trip');
  return t;
};

// Dispatch rules: same branch, not in maintenance, not overloaded, valid license, free at start time.
async function validateTrip(t, { start = false } = {}) {
  const f = {};
  if (t.destinationBranch) {
    if (same(t.destinationBranch, t.branch)) f.destinationBranch = 'Destination branch must differ from the origin branch';
    else if (!(await Branch.exists({ _id: t.destinationBranch, isActive: true }))) f.destinationBranch = 'Destination branch not found or inactive';
  }
  if (t.vehicle) {
    const v = await Vehicle.findById(t.vehicle);
    if (!v) f.vehicle = 'Selected vehicle does not exist';
    else if (!same(v.branch, t.branch)) f.vehicle = `${v.plate} belongs to a different branch`;
    else if (v.status === 'maintenance') f.vehicle = `${v.plate} is under maintenance`;
    else if (start && v.status === 'on-trip') f.vehicle = `${v.plate} is already on another trip`;
    else if (t.cargoWeightKg && v.capacityKg && t.cargoWeightKg > v.capacityKg) {
      f.cargoWeightKg = `Cargo (${t.cargoWeightKg} kg) exceeds ${v.plate}'s capacity (${v.capacityKg} kg)`;
    }
  }
  if (t.driver) {
    const d = await Driver.findById(t.driver);
    if (!d) f.driver = 'Selected driver does not exist';
    else if (!same(d.branch, t.branch)) f.driver = `${d.name} belongs to a different branch`;
    else if (d.status === 'off-duty') f.driver = `${d.name} is off duty`;
    else if (start && d.status === 'on-trip') f.driver = `${d.name} is already on another trip`;
    else if (d.licenseExpiry && d.licenseExpiry < new Date()) f.driver = `${d.name}'s license expired on ${d.licenseExpiry.toISOString().slice(0, 10)}`;
  }
  if (Object.keys(f).length) throw rule(start ? "This trip can't start yet. Check the highlighted items." : "This trip can't be saved. Check vehicle, driver and cargo details.", f);
}

// Picking a customer record fills in the customer name on the trip (kept as a snapshot).
async function applyCustomer(body) {
  if (!body.customerRef) return;
  if (!mongoose.isValidObjectId(body.customerRef)) throw invalid({ customerRef: 'Invalid customer' });
  const c = await Customer.findById(body.customerRef);
  if (!c) throw invalid({ customerRef: 'Customer not found' });
  if (!c.isActive) throw rule(`${c.name} is marked inactive`, { customerRef: 'This customer is inactive' });
  body.customer = c.name;
}

const free = async (t) => {
  if (t.vehicle) await Vehicle.updateOne({ _id: t.vehicle, status: 'on-trip' }, { status: 'available' });
  if (t.driver) await Driver.updateOne({ _id: t.driver, status: 'on-trip' }, { status: 'available' });
};

r.get('/', need('trips:read'), async (req, res) => {
  const { q, status } = req.query;
  const conds = [tripScope(req)];
  if (status) conds.push({ status: String(status) });
  if (q) conds.push({ $or: ['tripNo', 'customer', 'origin', 'destination'].map((k) => ({ [k]: new RegExp(esc(String(q)), 'i') })) });
  const pg = pageParams(req.query);
  const filter = { $and: conds };
  const query = Trip.find(filter).populate(POP).sort('-scheduledAt _id');
  const [trips, count] = pg ? await Promise.all([query.skip(pg.skip).limit(pg.limit), Trip.countDocuments(filter)]) : [await query.limit(500), 0];
  const totals = await expenseTotals(trips.map((t) => t._id));
  // Costs are shown only to the owning branch (and super admins), never to a destination branch.
  const myBranch = req.user.role === 'super_admin' ? null : String(userBranchId(req.user));
  res.json({
    ...(pg && { meta: pageMeta(pg, count) }),
    data: trips.map((t) => {
      const o = t.toObject();
      if (!myBranch || String(t.branch?._id ?? t.branch) === myBranch) o.expenseTotal = totals.get(String(t._id)) || 0;
      return o;
    }),
  });
});

r.post('/', need('trips:write'), async (req, res) => {
  const branch = await resolveTargetBranch(req);
  const body = pick(req.body);
  await applyCustomer(body);
  if (!body.customer?.trim() || !body.origin?.trim() || !body.destination?.trim() || !body.scheduledAt) {
    throw invalid({
      ...(!body.customer?.trim() && { customer: 'Customer is required', customerRef: 'Choose a customer' }),
      ...(!body.origin?.trim() && { origin: 'Origin is required' }),
      ...(!body.destination?.trim() && { destination: 'Destination is required' }),
      ...(!body.scheduledAt && { scheduledAt: 'Schedule date and time is required' }),
    });
  }
  await validateTrip({ ...body, branch: branch._id });
  const trip = await Trip.create({ ...body, branch: branch._id, tripNo: await nextTripNo(branch), createdBy: req.user._id });
  await audit(req, 'create', 'Trip', trip, trip.tripNo);
  res.status(201).json({ data: await Trip.findById(trip._id).populate(POP) });
});

r.put('/:id', need('trips:write'), async (req, res) => {
  const trip = await owned(req);
  if (['completed', 'cancelled'].includes(trip.status)) throw rule(`${trip.status === 'completed' ? 'Completed' : 'Cancelled'} trips can't be edited`);
  const body = pick(req.body);
  await applyCustomer(body);
  if (trip.status === 'in-transit' && ['vehicle', 'driver'].some((k) => body[k] !== undefined && !same(body[k], trip[k]))) {
    throw rule("Vehicle and driver can't be changed while the trip is in transit", { vehicle: 'Locked while in transit', driver: 'Locked while in transit' });
  }
  trip.set(body);
  await validateTrip(trip.toObject());
  await trip.save();
  await audit(req, 'update', 'Trip', trip, trip.tripNo);
  res.json({ data: await Trip.findById(trip._id).populate(POP) });
});

r.patch('/:id/status', async (req, res) => {
  const to = req.body.status;
  if (!Object.keys(NEXT).includes(to)) throw invalid({ status: 'Choose a valid status' });
  let trip;
  if (req.user.role === 'driver') {
    ensure(req, 'trips:status');
    assertId(req.params.id, 'Trip');
    trip = await Trip.findOne({ _id: req.params.id, ...tripScope(req) });
    if (!trip) throw notFound('Trip');
    if (!['in-transit', 'completed'].includes(to)) throw forbidden('Drivers can only start or complete their own trips');
  } else {
    ensure(req, 'trips:write');
    trip = await owned(req);
  }
  const allowed = NEXT[trip.status];
  if (!allowed.includes(to)) {
    throw rule(allowed.length
      ? `A ${trip.status} trip can't become "${to}". Next step: ${allowed.join(' or ')}.`
      : `This trip is already ${trip.status} and can't be changed.`);
  }
  if (to === 'in-transit') {
    if (!trip.vehicle || !trip.driver) {
      throw rule('Assign a vehicle and a driver before starting this trip', {
        ...(!trip.vehicle && { vehicle: 'Required to start' }), ...(!trip.driver && { driver: 'Required to start' }),
      });
    }
    await validateTrip(trip.toObject(), { start: true });
    trip.startedAt = new Date();
    await Vehicle.updateOne({ _id: trip.vehicle }, { status: 'on-trip' });
    await Driver.updateOne({ _id: trip.driver }, { status: 'on-trip' });
  } else {
    if (to === 'completed' && process.env.REQUIRE_POD === 'true' && !trip.pod) {
      throw rule('Upload proof of delivery before completing this trip', { pod: 'Required' });
    }
    if (trip.status === 'in-transit') await free(trip);
    if (to === 'completed') {
      trip.completedAt = new Date();
      if (trip.vehicle && trip.distanceKm) await Vehicle.updateOne({ _id: trip.vehicle }, { $inc: { odometerKm: trip.distanceKm } });
    }
  }
  trip.status = to;
  await trip.save();
  await audit(req, 'status', 'Trip', trip, `${trip.tripNo} -> ${to}`);
  emitTripStatus(trip);
  res.json({ data: await Trip.findById(trip._id).populate(POP) });
});

r.patch('/:id/payment', need('trips:payment'), async (req, res) => {
  const trip = await owned(req);
  const p = req.body.paymentStatus;
  if (!['unpaid', 'partial', 'paid'].includes(p)) throw invalid({ paymentStatus: 'Choose unpaid, partial or paid' });
  if (trip.status === 'cancelled') throw rule("Cancelled trips can't be invoiced");
  trip.paymentStatus = p;
  await trip.save();
  await audit(req, 'payment', 'Trip', trip, `${trip.tripNo} -> ${p}`);
  res.json({ data: await Trip.findById(trip._id).populate(POP) });
});

r.delete('/:id', need('trips:delete'), async (req, res) => {
  const trip = await owned(req);
  if (trip.status === 'in-transit') throw conflict("Trips in transit can't be deleted. Complete or cancel the trip first.");
  const spent = await Expense.countDocuments({ trip: trip._id });
  if (spent) throw conflict(`This trip has ${spent} expense record${spent > 1 ? 's' : ''}. Delete those first so the cost history isn't lost silently.`);
  await trip.deleteOne();
  await removeTripFiles(trip._id);
  await audit(req, 'delete', 'Trip', trip, trip.tripNo);
  res.json({ data: { ok: true } });
});

// Drivers push GPS readings for their own in-transit trip.
r.post('/:id/location', async (req, res) => {
  ensure(req, 'trips:location');
  assertId(req.params.id, 'Trip');
  if (!req.user.driverProfile) throw forbidden('Your login is not linked to a driver record. Ask your manager to fix this.');
  const trip = await Trip.findOne({ _id: req.params.id, driver: req.user.driverProfile });
  if (!trip) throw notFound('Trip');
  if (trip.status !== 'in-transit') throw rule('Location can only be shared while the trip is in transit');
  const reading = parseLocation(req.body);
  if (trip.lastLocation?.at && Date.now() - trip.lastLocation.at.getTime() < 3000) {
    throw new AppError(429, 'RATE_LIMITED', 'Location updates are limited to one every 3 seconds');
  }
  const at = new Date();
  trip.lastLocation = { ...reading, at };
  await trip.save();
  await LocationPing.create({ trip: trip._id, driver: trip.driver, branch: trip.branch, ...reading, at });
  await trip.populate('vehicle driver');
  emitLocation(trip, {
    tripId: String(trip._id), tripNo: trip.tripNo, branch: String(trip.branch), destinationBranch: trip.destinationBranch ? String(trip.destinationBranch) : null,
    plate: trip.vehicle?.plate, driverName: trip.driver?.name, ...reading, at,
  });
  res.status(201).json({ data: { at } });
});

const company = () => process.env.COMPANY_NAME || 'Haulwise';
const fileName = (no) => `${no.replace(/\//g, '-')}.pdf`;

// Issues (once) and renders the GST invoice for a completed trip.
async function renderInvoice(req) {
  const trip = await owned(req);
  if (trip.status !== 'completed') throw rule('Invoices are available once a trip is completed');
  const branch = await Branch.findById(trip.branch);
  const { invoice, created } = await ensureInvoice(trip, branch);
  if (created) await audit(req, 'invoice', 'Trip', trip, `${trip.tripNo} -> ${invoice.no}`);
  const [vehicle, driver, signature] = await Promise.all([
    trip.vehicle && Vehicle.findById(trip.vehicle), trip.driver && Driver.findById(trip.driver),
    trip.pod?.signature ? readPodFile(trip._id, trip.pod.signature) : null,
  ]);
  return { trip, invoice, pdf: await invoiceBuffer({ invoice, trip, vehicle, driver, signature }) };
}

r.get('/:id/invoice', need('invoices:read'), async (req, res) => {
  const { invoice, pdf } = await renderInvoice(req);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fileName(invoice.no)}"`, 'Content-Length': pdf.length });
  res.send(pdf);
});

r.post('/:id/invoice/email', need('invoices:read'), async (req, res) => {
  const { trip, invoice, pdf } = await renderInvoice(req);
  const customer = trip.customerRef ? await Customer.findById(trip.customerRef) : null;
  const to = String(req.body.to || customer?.email || '').trim();
  if (!to) throw invalid({ to: 'This customer has no email address. Enter one to send to.' });
  if (emailError(to)) throw invalid({ to: emailError(to) });
  try {
    const m = await sendMail({
      to, subject: `Invoice ${invoice.no} from ${company()}`,
      text: `Hello,\n\nPlease find attached invoice ${invoice.no} for trip ${trip.tripNo} (${trip.origin} to ${trip.destination}).\nTotal: Rs. ${invoice.total}\nDue date: ${new Date(invoice.dueDate).toDateString()}\n\nThank you,\n${company()}`,
      html: `<p>Hello,</p><p>Please find attached invoice <b>${escHtml(invoice.no)}</b> for trip ${escHtml(trip.tripNo)} (${escHtml(trip.origin)} to ${escHtml(trip.destination)}).</p><p>Total: <b>Rs. ${escHtml(invoice.total)}</b><br>Due date: ${escHtml(new Date(invoice.dueDate).toDateString())}</p><p>Thank you,<br>${escHtml(company())}</p>`,
      attachments: [{ filename: fileName(invoice.no), content: pdf, contentType: 'application/pdf' }],
    });
    await audit(req, 'invoice-email', 'Trip', trip, `${invoice.no} -> ${to}`);
    res.json({ data: { to, mailMode: m.mode } });
  } catch (e) {
    console.error('invoice email failed:', e.message);
    throw new AppError(502, 'MAIL_FAILED', 'The email could not be sent. Check the SMTP settings and try again.');
  }
});

// ---- proof of delivery ----
r.post('/:id/pod', async (req, res) => {
  assertId(req.params.id, 'Trip');
  let trip;
  if (req.user.role === 'driver') {
    ensure(req, 'trips:status');
    trip = await Trip.findOne({ _id: req.params.id, ...tripScope(req) });
  } else {
    ensure(req, 'trips:write');
    trip = await owned(req);
  }
  if (!trip) throw notFound('Trip');
  if (!['in-transit', 'completed'].includes(trip.status)) throw rule('Proof of delivery can be added once the trip is in transit');
  const { receiverName, notes, photos = [], signature } = req.body;
  const f = {};
  if (!String(receiverName || '').trim()) f.receiverName = "Enter the receiver's name";
  else if (String(receiverName).trim().length > 80) f.receiverName = 'Name is too long';
  if (!Array.isArray(photos)) f.photos = 'Photos must be a list';
  else if (photos.length > 3) f.photos = 'Attach at most 3 photos';
  else if (!photos.length && !signature) f.photos = 'Add at least one photo or a signature';
  if (notes && String(notes).length > 500) f.notes = 'Notes are too long (500 characters max)';
  if (Object.keys(f).length) throw invalid(f);
  const images = photos.map((p) => parseImage(p, 'photos'));
  const sig = signature ? parseImage(signature, 'signature', { maxBytes: 512 * 1024 }) : null;
  const where = req.body.lat !== undefined && req.body.lng !== undefined ? parseLocation({ lat: req.body.lat, lng: req.body.lng }) : {};

  const old = trip.pod;
  const photoNames = await Promise.all(images.map((i) => savePodFile(trip._id, i.buf, i.ext)));
  const signatureName = sig ? await savePodFile(trip._id, sig.buf, sig.ext) : undefined;
  trip.pod = { receiverName: String(receiverName).trim(), notes, photos: photoNames, signature: signatureName, lat: where.lat, lng: where.lng, deliveredAt: new Date(), submittedBy: req.user._id };
  await trip.save();
  if (old) await Promise.all([...(old.photos || []), old.signature].filter(Boolean).map((n) => removePodFile(trip._id, n)));
  await audit(req, 'pod', 'Trip', trip, `${trip.tripNo} received by ${trip.pod.receiverName}`);
  res.status(201).json({ data: trip.pod });
});

// Delivery photos are private: sign-in plus access to the trip (including the destination branch) is required.
r.get('/:id/pod/:file', need('trips:read'), async (req, res) => {
  assertId(req.params.id, 'Trip');
  const trip = await Trip.findOne({ $and: [tripScope(req), { _id: req.params.id }] }).select('pod');
  const name = req.params.file;
  if (!trip?.pod || ![...(trip.pod.photos || []), trip.pod.signature].includes(name)) throw notFound('File');
  const buf = await readPodFile(trip._id, name);
  if (!buf) throw notFound('File');
  res.set({ 'Content-Type': mimeOf(name), 'Cache-Control': 'private, max-age=3600' });
  res.send(buf);
});

// ---- customer tracking link ----
// Each call creates a fresh link and retires the previous one. Only a hash of the token is stored.
r.post('/:id/share', need('trips:write'), async (req, res) => {
  const trip = await owned(req);
  if (trip.status === 'cancelled') throw rule("Cancelled trips can't be shared");
  const wantEmail = req.body.email === true || req.body.email === 'true';
  let customer = null;
  if (wantEmail) {
    customer = trip.customerRef ? await Customer.findById(trip.customerRef) : null;
    if (!customer?.email) throw invalid({ email: 'This customer has no email address. Add one under Customers.' });
  }
  const token = crypto.randomBytes(24).toString('base64url');
  trip.trackHash = hashToken(token);
  trip.trackExpiresAt = new Date(Date.now() + Number(process.env.TRACK_LINK_DAYS || 14) * 864e5);
  await trip.save();
  await audit(req, 'share', 'Trip', trip, trip.tripNo);
  const url = `${publicUrl()}/track/${token}`;
  const out = { url, expiresAt: trip.trackExpiresAt, emailed: false };
  if (wantEmail) {
    try {
      const m = await sendMail({
        to: customer.email, subject: `Track your shipment ${trip.tripNo}`,
        text: `Hello,\n\nYou can follow shipment ${trip.tripNo} (${trip.origin} to ${trip.destination}) here:\n${url}\n\nThe link is valid until ${trip.trackExpiresAt.toDateString()}.\n\n${company()}`,
        html: `<p>Hello,</p><p>You can follow shipment <b>${escHtml(trip.tripNo)}</b> (${escHtml(trip.origin)} to ${escHtml(trip.destination)}) here:</p><p><a href="${escHtml(url)}">${escHtml(url)}</a></p><p>The link is valid until ${escHtml(trip.trackExpiresAt.toDateString())}.</p><p>${escHtml(company())}</p>`,
      });
      Object.assign(out, { emailed: true, mailMode: m.mode, to: customer.email });
    } catch (e) {
      console.error('tracking email failed:', e.message);
      out.emailError = 'The link was created but the email could not be sent. Copy the link and send it yourself, or check the SMTP settings.';
    }
  }
  res.status(201).json({ data: out });
});

r.delete('/:id/share', need('trips:write'), async (req, res) => {
  const trip = await owned(req);
  trip.trackHash = undefined;
  trip.trackExpiresAt = undefined;
  await trip.save();
  await audit(req, 'unshare', 'Trip', trip, trip.tripNo);
  res.json({ data: { ok: true } });
});

export default r;
