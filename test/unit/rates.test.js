import '../setup-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickRateCard, calcFare } from '../../src/utils/rates.js';

const cards = [
  { _id: 'a', name: 'Default any', vehicleType: 'any', isActive: true },
  { _id: 'b', name: 'Default truck', vehicleType: 'truck', isActive: true },
  { _id: 'c', name: 'Acme any', customer: 'acme', vehicleType: 'any', isActive: true },
  { _id: 'd', name: 'Acme truck', customer: 'acme', vehicleType: 'truck', isActive: true },
  { _id: 'e', name: 'Old', customer: 'acme', vehicleType: 'truck', isActive: false },
];

test('the most specific active card wins', () => {
  assert.equal(pickRateCard(cards, { customerId: 'acme', vehicleType: 'truck' }).name, 'Acme truck');
  assert.equal(pickRateCard(cards, { customerId: 'acme', vehicleType: 'van' }).name, 'Acme any');
  assert.equal(pickRateCard(cards, { customerId: 'other', vehicleType: 'truck' }).name, 'Default truck');
  assert.equal(pickRateCard(cards, { customerId: 'other', vehicleType: 'van' }).name, 'Default any');
});

test('inactive cards and other customers\' cards are ignored', () => {
  assert.equal(pickRateCard([cards[4]], { customerId: 'acme', vehicleType: 'truck' }), null);
  assert.equal(pickRateCard([cards[2]], { customerId: 'other', vehicleType: 'truck' }), null);
});

test('fare = base + per-km + per-tonne, never below the minimum', () => {
  const card = { baseFare: 2000, perKm: 18, perTonne: 100, minFare: 5000 };
  assert.deepEqual(calcFare(card, { distanceKm: 280, cargoWeightKg: 8000 }), { fare: 7840, base: 2000, distance: 5040, weight: 800, minApplied: false });
  const small = calcFare(card, { distanceKm: 10, cargoWeightKg: 500 });
  assert.equal(small.fare, 5000);
  assert.equal(small.minApplied, true);
});
