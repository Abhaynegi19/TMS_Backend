import '../setup-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLocation } from '../../src/utils/geo.js';

test('accepts a normal reading, including numeric strings', () => {
  assert.deepEqual(parseLocation({ lat: 28.61, lng: 77.2, speed: 55, heading: 90, accuracy: 12 }), { lat: 28.61, lng: 77.2, speed: 55, heading: 90, accuracy: 12 });
  assert.equal(parseLocation({ lat: '28.5', lng: '77.1' }).lat, 28.5);
});

test('optional fields may be left out', () => {
  const r = parseLocation({ lat: 0, lng: 0 });
  assert.equal(r.speed, undefined);
});

test('rejects out-of-range and missing coordinates with field messages', () => {
  assert.throws(() => parseLocation({ lat: 91, lng: 0 }), (e) => e.status === 422 && /Latitude/.test(e.fields.lat));
  assert.throws(() => parseLocation({ lat: 0, lng: -181 }), (e) => /Longitude/.test(e.fields.lng));
  assert.throws(() => parseLocation({}), (e) => Boolean(e.fields.lat && e.fields.lng));
  assert.throws(() => parseLocation({ lat: 'abc', lng: 1 }), (e) => Boolean(e.fields.lat));
});

test('rejects nonsense speed, heading and accuracy', () => {
  assert.throws(() => parseLocation({ lat: 1, lng: 1, speed: -5 }), (e) => Boolean(e.fields.speed));
  assert.throws(() => parseLocation({ lat: 1, lng: 1, heading: 400 }), (e) => Boolean(e.fields.heading));
});
