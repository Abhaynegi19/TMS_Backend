import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import Trip from '../models/Trip.js';
import LocationPing from '../models/LocationPing.js';
import { AppError } from '../utils/errors.js';
import { hashToken } from '../utils/links.js';

const r = Router();
const limiter = rateLimit({
  windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === 'test',
  handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Please wait a minute and try again.')),
});
// One message for unknown, expired and revoked links, so links can't be probed.
const gone = () => new AppError(404, 'NOT_FOUND', 'This tracking link is invalid or has expired');

// No sign-in: the unguessable token is the credential. Returns only what a customer needs, never fares, customer data or internal ids.
r.get('/track/:token', limiter, async (req, res) => {
  const { token } = req.params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw gone();
  const trip = await Trip.findOne({ trackHash: hashToken(token), trackExpiresAt: { $gt: new Date() } })
    .populate('vehicle', 'plate').populate('driver', 'name').populate('branch', 'name phone').populate('destinationBranch', 'name');
  if (!trip) throw gone();
  const moving = trip.status === 'in-transit';
  const trail = moving
    ? (await LocationPing.find({ trip: trip._id }).sort('-at').limit(100).select('lat lng -_id')).reverse().map((p) => [p.lat, p.lng])
    : [];
  const loc = trip.lastLocation;
  res.set('Cache-Control', 'no-store');
  res.json({
    data: {
      tripNo: trip.tripNo, status: trip.status, origin: trip.origin, destination: trip.destination,
      scheduledAt: trip.scheduledAt, startedAt: trip.startedAt ?? null, completedAt: trip.completedAt ?? null,
      vehiclePlate: trip.vehicle?.plate || null, driverFirstName: trip.driver?.name?.split(' ')[0] || null,
      branch: { name: trip.branch?.name, phone: trip.branch?.phone }, destinationBranchName: trip.destinationBranch?.name || null,
      location: moving && loc?.lat != null ? { lat: loc.lat, lng: loc.lng, at: loc.at } : null, trail,
      delivery: trip.pod ? { receiverName: trip.pod.receiverName, deliveredAt: trip.pod.deliveredAt } : null,
      expiresAt: trip.trackExpiresAt,
    },
  });
});
export default r;
