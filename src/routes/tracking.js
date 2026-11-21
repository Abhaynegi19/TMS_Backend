import { Router } from 'express';
import Trip from '../models/Trip.js';
import LocationPing from '../models/LocationPing.js';
import { need } from '../middleware/auth.js';
import { notFound } from '../utils/errors.js';
import { assertId, tripScope } from '../utils/scope.js';

const r = Router();

// Trips currently on the road within the caller's scope (with their last known position, if any).
r.get('/live', need('tracking:read'), async (req, res) => {
  const trips = await Trip.find({ $and: [tripScope(req), { status: 'in-transit' }] })
    .select('tripNo branch destinationBranch origin destination customer vehicle driver lastLocation startedAt')
    .populate('vehicle', 'plate').populate('driver', 'name').populate('branch', 'code').populate('destinationBranch', 'code');
  res.json({ data: trips });
});

// Breadcrumb trail for one trip.
r.get('/trail/:id', need('tracking:read'), async (req, res) => {
  assertId(req.params.id, 'Trip');
  const trip = await Trip.findOne({ $and: [tripScope(req), { _id: req.params.id }] }).select('tripNo');
  if (!trip) throw notFound('Trip');
  const points = await LocationPing.find({ trip: trip._id }).sort('at').limit(1000).select('lat lng speed at -_id');
  res.json({ data: { tripNo: trip.tripNo, points } });
});

export default r;
