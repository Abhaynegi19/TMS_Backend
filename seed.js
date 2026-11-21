// Demo data: node seed.js   (add --force to wipe and reseed)
import './src/config/env.js';
import mongoose from 'mongoose';
import Branch from './src/models/Branch.js';
import User from './src/models/User.js';
import Vehicle from './src/models/Vehicle.js';
import Driver from './src/models/Driver.js';
import Trip from './src/models/Trip.js';
import Counter from './src/models/Counter.js';
import AuditLog from './src/models/AuditLog.js';
import LocationPing from './src/models/LocationPing.js';
import Customer from './src/models/Customer.js';
import RateCard from './src/models/RateCard.js';
import MaintenanceLog from './src/models/MaintenanceLog.js';
import AlertLog from './src/models/AlertLog.js';
import Expense from './src/models/Expense.js';
import { nextTripNo } from './src/utils/counter.js';
import { gstinCheckChar } from './src/utils/gst.js';

await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
if ((await User.countDocuments()) > 0) {
  if (!process.argv.includes('--force')) { console.error('Database already has data. Re-run with --force to wipe and reseed.'); process.exit(1); }
  await Promise.all([Branch, User, Vehicle, Driver, Trip, Counter, AuditLog, LocationPing, Customer, RateCard, MaintenanceLog, AlertLog, Expense].map((M) => M.deleteMany({})));
}
const PW = 'Passw0rd!';
const day = (n) => new Date(Date.now() + n * 864e5);
const gstin = (first14) => first14 + gstinCheckChar(first14); // demo GSTINs with a correct checksum

const [del, mum] = await Branch.create([
  { name: 'Delhi Hub', code: 'DEL', city: 'New Delhi', address: 'Plot 12, Transport Nagar', phone: '+91 11 5550 0101', email: 'delhi@haulwise.test', gstin: gstin('07AAACH5678K1Z') },
  { name: 'Mumbai Depot', code: 'MUM', city: 'Mumbai', address: 'Warehouse 4, Bhiwandi Road', phone: '+91 22 5550 0202', email: 'mumbai@haulwise.test', gstin: gstin('27AAACH5678K1Z') },
]);
const [apex, north] = await Customer.create([
  { name: 'Apex Retail Pvt Ltd', contactName: 'Meera Shah', phone: '9810011111', email: 'accounts@apex.test', address: '12 Okhla Industrial Area', city: 'New Delhi', gstin: gstin('07AAACA1234A1Z'), paymentTermsDays: 30 },
  { name: 'Northwind Foods', contactName: 'Arjun Rao', phone: '9820022222', email: 'billing@northwind.test', address: '88 Andheri East', city: 'Mumbai', gstin: gstin('27AAACN4321B1Z'), paymentTermsDays: 15 },
]);
await RateCard.create([
  { name: 'Standard truck', vehicleType: 'truck', baseFare: 2000, perKm: 18, perTonne: 100, minFare: 5000 },
  { name: 'Standard (any vehicle)', vehicleType: 'any', baseFare: 1500, perKm: 14, perTonne: 80, minFare: 3000 },
  { name: 'Apex contract', customer: apex._id, vehicleType: 'any', baseFare: 1000, perKm: 15, perTonne: 90, minFare: 4000 },
]);

const [v1, v2, v3, v4] = await Vehicle.create([
  { branch: del._id, plate: 'DL01AB1234', type: 'truck', capacityKg: 12000, odometerKm: 9400, serviceIntervalKm: 10000, lastServiceKm: 0, insuranceExpiry: day(10), permitExpiry: day(200), fitnessExpiry: day(-3) },
  { branch: del._id, plate: 'DL02CD5678', type: 'van', capacityKg: 2500, odometerKm: 4200, serviceIntervalDays: 180, lastService: day(-170), pucExpiry: day(25) },
  { branch: del._id, plate: 'DL03EF9012', type: 'trailer', capacityKg: 24000, status: 'maintenance' },
  { branch: mum._id, plate: 'MH01GH3456', type: 'truck', capacityKg: 10000, odometerKm: 15000, insuranceExpiry: day(120) },
]);
const [d1, d2, d3] = await Driver.create([
  { branch: del._id, name: 'Ravi Kumar', phone: '9810000001', licenseNo: 'DL-2019-0001', licenseExpiry: day(500) },
  { branch: del._id, name: 'Sanjay Singh', phone: '9810000002', licenseNo: 'DL-2018-0002', licenseExpiry: day(12) },
  { branch: mum._id, name: 'Imran Shaikh', phone: '9820000003', licenseNo: 'MH-2020-0003', licenseExpiry: day(700) },
]);
await MaintenanceLog.create({ branch: del._id, vehicle: v1._id, type: 'service', date: day(-200), odometerKm: 0, cost: 8500, vendor: 'Sharma Motors', notes: 'Full service, oil and filters' });

const mk = (name, email, role, branch, extra = {}) => User.create({ name, email, password: PW, role, branch: branch?._id, ...extra });
await mk('Head Office Admin', 'admin@tms.test', 'super_admin', del);
await mk('Delhi Manager', 'manager.del@tms.test', 'branch_manager', del);
await mk('Delhi Dispatcher', 'dispatch.del@tms.test', 'dispatcher', del);
await mk('Delhi Accountant', 'accounts.del@tms.test', 'accountant', del);
await mk('Ravi Kumar', 'driver.del@tms.test', 'driver', del, { driverProfile: d1._id });
await mk('Mumbai Manager', 'manager.mum@tms.test', 'branch_manager', mum);
await mk('Mumbai Dispatcher', 'dispatch.mum@tms.test', 'dispatcher', mum);

const trip = async (branch, data) => Trip.create({ branch: branch._id, tripNo: await nextTripNo(branch), ...data });
await trip(del, { customer: apex.name, customerRef: apex._id, origin: 'Delhi', destination: 'Jaipur', cargoWeightKg: 8000, scheduledAt: day(-6), vehicle: v1._id, driver: d1._id, status: 'completed', paymentStatus: 'paid', distanceKm: 280, fare: 42000, startedAt: day(-6), completedAt: day(-5) });
const done = await Trip.findOne({ status: 'completed', branch: del._id });
const live = await trip(del, { customer: north.name, customerRef: north._id, origin: 'Delhi', destination: 'Mumbai', destinationBranch: mum._id, cargoWeightKg: 1800, scheduledAt: day(-1), vehicle: v2._id, driver: d2._id, status: 'in-transit', distanceKm: 1400, fare: 98000, startedAt: day(-1) });
// a short trail on the Delhi -> Mumbai trip: Delhi, Mathura, Agra, Gwalior
const trail = [[28.61, 77.21], [27.49, 77.67], [27.18, 78.01], [26.22, 78.18]];
const minsAgo = (m) => new Date(Date.now() - m * 60000);
await LocationPing.create(trail.map(([lat, lng], i) => ({ trip: live._id, driver: d2._id, branch: del._id, lat, lng, speed: 55 + i * 3, at: minsAgo((trail.length - i) * 20) })));
await Trip.updateOne({ _id: live._id }, { lastLocation: { lat: 26.22, lng: 78.18, speed: 64, heading: 170, at: minsAgo(0) } });
await trip(del, { customer: apex.name, customerRef: apex._id, origin: 'Delhi', destination: 'Lucknow', scheduledAt: day(2), distanceKm: 550, fare: 51000 });
await trip(mum, { customer: north.name, customerRef: north._id, origin: 'Mumbai', destination: 'Pune', cargoWeightKg: 6000, scheduledAt: day(1), vehicle: v4._id, driver: d3._id, distanceKm: 150, fare: 21000 });
const spend = (t, driver, vehicle, category, amount, extra = {}) => Expense.create({ branch: del._id, trip: t._id, driver, vehicle, category, amount, date: t.startedAt || new Date(), ...extra });
await spend(done, d1._id, v1._id, 'diesel', 9800, { litres: 105, notes: 'Full tank at Neemrana' });
await spend(done, d1._id, v1._id, 'toll', 1450);
await spend(live, d2._id, v2._id, 'diesel', 3600, { litres: 38 });
await spend(live, d2._id, v2._id, 'toll', 820);
await spend(live, d2._id, v2._id, 'other', 300, { notes: 'Weighbridge fee' });
await Vehicle.updateOne({ _id: v2._id }, { status: 'on-trip' });
await Driver.updateOne({ _id: d2._id }, { status: 'on-trip' });

console.log(`Seeded 2 branches, 7 users, 2 customers, 3 rate cards, 4 vehicles, 3 drivers, 4 trips.\nAll demo accounts use password: ${PW}\n  admin@tms.test (Super Admin) | manager.del@tms.test | dispatch.del@tms.test | accounts.del@tms.test | driver.del@tms.test\nExpiring soon: DL01AB1234 insurance (10 days) and fitness (expired), driver Sanjay Singh's license (12 days).`);
await mongoose.disconnect();
