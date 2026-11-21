import { Router } from 'express';
import mongoose from 'mongoose';
import crud from './crud.js';
import Customer from '../models/Customer.js';
import RateCard from '../models/RateCard.js';
import MaintenanceLog from '../models/MaintenanceLog.js';
import Vehicle from '../models/Vehicle.js';
import Trip from '../models/Trip.js';
import { need } from '../middleware/auth.js';
import { conflict, invalid, rule } from '../utils/errors.js';
import { failIf } from '../utils/validators.js';
import { calcFare, pickRateCard } from '../utils/rates.js';

export const customers = crud({
  name: 'customers', label: 'Customer', Model: Customer, populate: [], scoped: false, sort: 'name',
  search: ['name', 'contactName', 'phone', 'gstin', 'city'],
  writable: ['name', 'contactName', 'phone', 'email', 'address', 'city', 'stateCode', 'gstin', 'paymentTermsDays', 'isActive', 'notes'],
  ident: (d) => d.name,
  beforeDelete: async (d) => {
    const n = await Trip.countDocuments({ customerRef: d._id });
    if (n) throw conflict(`Can't delete ${d.name}: it has ${n} trip${n > 1 ? 's' : ''}. Mark the customer inactive instead.`);
  },
});

const rateCrud = crud({
  name: 'rates', label: 'Rate card', Model: RateCard, populate: 'customer', scoped: false, sort: 'name', search: ['name'],
  writable: ['name', 'customer', 'vehicleType', 'baseFare', 'perKm', 'perTonne', 'minFare', 'isActive'],
  ident: (d) => d.name,
  before: async (body) => {
    if (!body.customer) { body.customer = null; return; }
    if (!mongoose.isValidObjectId(body.customer) || !(await Customer.exists({ _id: body.customer }))) throw invalid({ customer: 'Customer not found' });
  },
});

// Fare suggestion from the best matching rate card. Used by the "Calculate fare" button on trips.
export const rates = Router();
rates.post('/quote', need('rates:read'), async (req, res) => {
  const { customer, vehicleType = 'any', distanceKm = 0, cargoWeightKg = 0 } = req.body;
  const f = {};
  if (!customer) f.customer = 'Choose a customer first';
  else if (!mongoose.isValidObjectId(customer)) f.customer = 'Invalid customer';
  const km = Number(distanceKm), kg = Number(cargoWeightKg);
  if (!Number.isFinite(km) || km < 0) f.distanceKm = 'Distance must be zero or more';
  if (!Number.isFinite(kg) || kg < 0) f.cargoWeightKg = 'Cargo weight must be zero or more';
  failIf(f);
  const card = pickRateCard(await RateCard.find({ isActive: true }), { customerId: customer, vehicleType });
  if (!card) throw rule('No active rate card matches this customer and vehicle type. Ask a Super Admin to add one.');
  res.json({ data: { ...calcFare(card, { distanceKm: km, cargoWeightKg: kg }), rateCard: { _id: card._id, name: card.name } } });
});
rates.use('/', rateCrud);

const sameId = (a, b) => String(a?._id ?? a) === String(b?._id ?? b);
export const maintenance = crud({
  name: 'maintenance', label: 'Maintenance record', Model: MaintenanceLog, populate: 'branch vehicle', sort: '-date', search: ['vendor', 'notes'],
  writable: ['vehicle', 'type', 'date', 'odometerKm', 'cost', 'vendor', 'notes'],
  ident: (d) => `${d.type} ${d.date ? d.date.toISOString().slice(0, 10) : ''}`,
  before: async (body, doc, req, branch) => {
    const id = body.vehicle ?? doc?.vehicle;
    if (!id || !mongoose.isValidObjectId(id)) throw invalid({ vehicle: 'Choose a vehicle' });
    const v = await Vehicle.findById(id);
    if (!v) throw invalid({ vehicle: 'Vehicle not found' });
    if (!sameId(v.branch, branch)) throw invalid({ vehicle: 'This vehicle belongs to a different branch' });
    if (!doc) { body.createdBy = req.user._id; if (body.odometerKm === undefined) body.odometerKm = v.odometerKm; }
  },
  // A service record resets the vehicle's service clock; any record can push the odometer forward.
  after: async (doc) => {
    const v = await Vehicle.findById(doc.vehicle);
    if (!v) return;
    const upd = {};
    if (doc.type === 'service' && (!v.lastService || doc.date >= v.lastService)) { upd.lastService = doc.date; upd.lastServiceKm = doc.odometerKm ?? v.odometerKm; }
    if (doc.odometerKm > v.odometerKm) upd.odometerKm = doc.odometerKm;
    if (Object.keys(upd).length) await Vehicle.updateOne({ _id: v._id }, upd);
  },
});
