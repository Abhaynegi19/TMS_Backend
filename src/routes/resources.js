import crud from './crud.js';
import Vehicle from '../models/Vehicle.js';
import Driver from '../models/Driver.js';
import Trip from '../models/Trip.js';
import { conflict, rule } from '../utils/errors.js';

// Vehicle/driver availability is driven by trips; users can only toggle it when nothing is in flight.
const statusGuard = (label) => (body, doc) => {
  if (body.status === undefined || body.status === doc?.status) return;
  if (body.status === 'on-trip') {
    throw rule('"On trip" is set automatically when a trip starts', { status: 'Cannot be set manually' });
  }
  if (doc?.status === 'on-trip') {
    throw rule(`This ${label} is on a trip right now. Complete or cancel the trip before changing its status.`, { status: 'Currently on a trip' });
  }
};

const openTrips = (field, id) => Trip.countDocuments({ [field]: id, status: { $in: ['planned', 'in-transit'] } });

export const vehicles = crud({
  name: 'vehicles', label: 'Vehicle', Model: Vehicle, search: ['plate', 'type'],
  writable: ['plate', 'type', 'capacityKg', 'status', 'lastService', 'lastServiceKm', 'serviceIntervalKm', 'serviceIntervalDays', 'odometerKm', 'insuranceExpiry', 'permitExpiry', 'fitnessExpiry', 'pucExpiry', 'notes'],
  ident: (d) => d.plate, before: statusGuard('vehicle'),
  beforeDelete: async (d) => {
    const n = await openTrips('vehicle', d._id);
    if (n) throw conflict(`Can't delete ${d.plate}: it is assigned to ${n} open trip${n > 1 ? 's' : ''}. Reassign or cancel them first.`);
  },
});

export const drivers = crud({
  name: 'drivers', label: 'Driver', Model: Driver, search: ['name', 'phone', 'licenseNo'],
  writable: ['name', 'phone', 'licenseNo', 'licenseExpiry', 'status'],
  ident: (d) => d.name, before: statusGuard('driver'),
  beforeDelete: async (d) => {
    const n = await openTrips('driver', d._id);
    if (n) throw conflict(`Can't delete ${d.name}: assigned to ${n} open trip${n > 1 ? 's' : ''}. Reassign or cancel them first.`);
  },
});
