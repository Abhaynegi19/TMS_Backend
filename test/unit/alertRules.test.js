import '../setup-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { daysUntil, vehicleAlerts, driverAlerts, sortAlerts } from '../../src/utils/alertRules.js';

const NOW = new Date('2026-11-17T09:00:00Z');
const inDays = (n) => new Date(NOW.getTime() + n * 864e5);
const veh = (extra) => ({ _id: 'v1', plate: 'DL01', branch: { code: 'DEL' }, ...extra });

test('daysUntil counts calendar days', () => {
  assert.equal(daysUntil(inDays(10), NOW), 10);
  assert.equal(daysUntil(inDays(-2), NOW), -2);
  assert.equal(daysUntil(NOW, NOW), 0);
});

test('documents are flagged only inside the 30-day window', () => {
  assert.equal(vehicleAlerts(veh({ insuranceExpiry: inDays(31) }), NOW).length, 0);
  const [a] = vehicleAlerts(veh({ insuranceExpiry: inDays(30) }), NOW);
  assert.equal(a.kind, 'insurance');
  assert.equal(a.severity, 'upcoming');
});

test('severity and bucket follow the deadline', () => {
  const at = (n) => vehicleAlerts(veh({ permitExpiry: inDays(n) }), NOW)[0];
  assert.equal(at(25).bucket, 't30');
  assert.equal(at(10).bucket, 't14');
  assert.equal(at(5).bucket, 't7');
  assert.equal(at(2).bucket, 't3');
  assert.equal(at(1).bucket, 't1');
  assert.equal(at(0).bucket, 'today');
  assert.equal(at(5).severity, 'soon');
  assert.equal(at(-1).severity, 'expired');
  assert.equal(at(-1).bucket, 'overdue-w0');
  assert.equal(at(-15).bucket, 'overdue-w2');
});

test('keys stay the same within a stage, change at the next stage, and change on renewal', () => {
  const expiry = inDays(10);
  const keyAt = (offsetDays, exp = expiry) => vehicleAlerts(veh({ fitnessExpiry: exp }), new Date(NOW.getTime() + offsetDays * 864e5))[0].key;
  assert.equal(keyAt(0), keyAt(1), '10 and 9 days left are the same stage (14 days)');
  assert.notEqual(keyAt(0), keyAt(4), '6 days left is the next stage (7 days)');
  assert.notEqual(keyAt(0), vehicleAlerts(veh({ fitnessExpiry: inDays(375) }), new Date(NOW.getTime() + 360 * 864e5))[0].key, 'a renewed document starts fresh');
});

test('service by date uses last service plus the interval', () => {
  const v = veh({ serviceIntervalDays: 180, lastService: inDays(-170) });
  const [a] = vehicleAlerts(v, NOW);
  assert.equal(a.kind, 'service-date');
  assert.equal(a.days, 10);
  assert.equal(vehicleAlerts(veh({ serviceIntervalDays: 180 }), NOW).length, 0, 'no last service recorded');
  assert.equal(vehicleAlerts(veh({ serviceIntervalDays: 0, lastService: inDays(-500) }), NOW).length, 0, 'interval off');
});

test('service by distance warns within 1000 km and when overdue', () => {
  const at = (odo) => vehicleAlerts(veh({ serviceIntervalKm: 10000, lastServiceKm: 0, odometerKm: odo }), NOW)[0];
  assert.equal(at(8000), undefined);
  assert.equal(at(9400).remainingKm, 600);
  assert.equal(at(9400).severity, 'upcoming');
  assert.equal(at(9800).severity, 'soon');
  assert.equal(at(10300).remainingKm, -300);
  assert.equal(at(10300).severity, 'expired');
  assert.notEqual(at(9400).key, at(9800).key);
});

test('driver licences', () => {
  const d = { _id: 'd1', name: 'Ravi', branch: { code: 'DEL' }, licenseExpiry: inDays(12) };
  assert.equal(driverAlerts(d, NOW)[0].kind, 'license');
  assert.equal(driverAlerts({ ...d, licenseExpiry: inDays(90) }, NOW).length, 0);
  assert.equal(driverAlerts({ ...d, licenseExpiry: undefined }, NOW).length, 0);
});

test('sorting puts expired first, then the soonest', () => {
  const list = [
    ...vehicleAlerts(veh({ insuranceExpiry: inDays(20), permitExpiry: inDays(-4), pucExpiry: inDays(3) }), NOW),
  ];
  assert.deepEqual(sortAlerts(list).map((a) => a.kind), ['permit', 'puc', 'insurance']);
});
