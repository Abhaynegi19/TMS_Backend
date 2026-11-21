// Shared setup for the integration suites. Each suite uses its own database (MONGO_URI_TEST + "_<suffix>")
// so suites can run in parallel. Those databases are WIPED, and their names must contain "test".
import '../setup-env.js';
import mongoose from 'mongoose';
import request from 'supertest';
import assert from 'node:assert/strict';
import app from '../../src/app.js';
import Branch from '../../src/models/Branch.js';
import User from '../../src/models/User.js';
import Vehicle from '../../src/models/Vehicle.js';
import Driver from '../../src/models/Driver.js';
import Trip from '../../src/models/Trip.js';
import Counter from '../../src/models/Counter.js';
import AuditLog from '../../src/models/AuditLog.js';
import LocationPing from '../../src/models/LocationPing.js';
import Customer from '../../src/models/Customer.js';
import RateCard from '../../src/models/RateCard.js';
import MaintenanceLog from '../../src/models/MaintenanceLog.js';
import AlertLog from '../../src/models/AlertLog.js';

export { app, mongoose };
export const PW = 'Passw0rd!';
export const W = {}; // the "world": ids and tokens shared by the tests of one suite

// Returns false when ready, or a string explaining why the suite must be skipped.
export async function connectTestDb(suffix) {
  const url = new URL(process.env.MONGO_URI_TEST || 'mongodb://127.0.0.1:27017/tms_pro_test');
  url.pathname = `${url.pathname}_${suffix}`;
  try {
    await mongoose.connect(url.toString(), { serverSelectionTimeoutMS: 2500 });
  } catch {
    const why = `MongoDB is not reachable at ${url.host}. Start it or set MONGO_URI_TEST.`;
    console.warn(`\n! Integration tests skipped: ${why}\n`);
    return why;
  }
  if (!/test/i.test(mongoose.connection.name)) return `refusing to wipe "${mongoose.connection.name}": the database name must contain "test"`;
  return false;
}

export const wipe = () => Promise.all([Branch, User, Vehicle, Driver, Trip, Counter, AuditLog, LocationPing, Customer, RateCard, MaintenanceLog, AlertLog].map((M) => M.deleteMany({})));
export const tomorrow = () => new Date(Date.now() + 864e5).toISOString();
export const inDays = (n) => new Date(Date.now() + n * 864e5);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const binary = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };

export const call = (method, url, token, body, headers = {}) => {
  let r = request(app)[method](url);
  if (token) r = r.set('Authorization', `Bearer ${token}`);
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return body === undefined ? r : r.send(body);
};
export const newTrip = async (overrides = {}, token = W.t.dispDel) => {
  const r = await call('post', '/api/trips', token, { customer: 'Acme', origin: 'Delhi', destination: 'Agra', scheduledAt: tomorrow(), ...overrides });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data;
};
export const setStatus = (id, status, token) => call('patch', `/api/trips/${id}/status`, token, { status });

export async function buildWorld() {
  await wipe();
  const future = inDays(400), past = inDays(-1);
  const [del, mum] = await Branch.create([{ name: 'Delhi Hub', code: 'DEL' }, { name: 'Mumbai Depot', code: 'MUM' }]);
  const [v1, v2, vMaint, vMum] = await Vehicle.create([
    { branch: del._id, plate: 'DL01', capacityKg: 12000 }, { branch: del._id, plate: 'DL02', capacityKg: 2500 },
    { branch: del._id, plate: 'DL03', status: 'maintenance' }, { branch: mum._id, plate: 'MH01', capacityKg: 10000 },
  ]);
  const [d1, d2, dExpired, dMum] = await Driver.create([
    { branch: del._id, name: 'Ravi Kumar', phone: '1', licenseNo: 'L1', licenseExpiry: future }, { branch: del._id, name: 'Sanjay', phone: '2', licenseNo: 'L2', licenseExpiry: future },
    { branch: del._id, name: 'Expired', phone: '3', licenseNo: 'L3', licenseExpiry: past }, { branch: mum._id, name: 'Imran', phone: '4', licenseNo: 'L4', licenseExpiry: future },
  ]);
  const mk = (name, email, role, branch, extra = {}) => User.create({ name, email, password: PW, role, branch: branch?._id, ...extra });
  const users = {
    admin: await mk('Admin', 'admin@t.test', 'super_admin', del), mgrDel: await mk('Mgr Del', 'mgr.del@t.test', 'branch_manager', del),
    dispDel: await mk('Disp Del', 'disp.del@t.test', 'dispatcher', del), acctDel: await mk('Acct Del', 'acct.del@t.test', 'accountant', del),
    drv1: await mk('Ravi', 'drv1@t.test', 'driver', del, { driverProfile: d1._id }), drv2: await mk('Sanjay', 'drv2@t.test', 'driver', del, { driverProfile: d2._id }),
    mgrMum: await mk('Mgr Mum', 'mgr.mum@t.test', 'branch_manager', mum), dispMum: await mk('Disp Mum', 'disp.mum@t.test', 'dispatcher', mum),
  };
  W.t = {};
  for (const [k, u] of Object.entries(users)) {
    const r = await call('post', '/api/auth/login', null, { email: u.email, password: PW });
    assert.equal(r.status, 200, `login ${k}`);
    W.t[k] = r.body.data.token;
  }
  Object.assign(W, { del, mum, v1, v2, vMaint, vMum, d1, d2, dExpired, dMum, users });
}
