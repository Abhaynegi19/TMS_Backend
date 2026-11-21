import '../setup-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { errorHandler } from '../../src/utils/errorHandler.js';
import { AppError, notFound, forbidden } from '../../src/utils/errors.js';
import Vehicle from '../../src/models/Vehicle.js';

const run = (err) => {
  const out = {};
  const res = { status(s) { out.status = s; return this; }, json(b) { out.body = b; } };
  errorHandler(err, { id: 'req-123' }, res, () => {});
  return out;
};

test('AppError keeps its status, code and fields', () => {
  const o = run(new AppError(422, 'BUSINESS_RULE', 'Nope', { vehicle: 'Busy' }));
  assert.equal(o.status, 422);
  assert.deepEqual(o.body, { success: false, error: { code: 'BUSINESS_RULE', message: 'Nope', fields: { vehicle: 'Busy' }, requestId: undefined } });
});

test('helpers map to the right statuses', () => {
  assert.equal(run(notFound('Trip')).status, 404);
  assert.equal(run(forbidden()).body.error.code, 'FORBIDDEN');
});

test('mongoose validation errors become per-field messages', () => {
  const o = run(new Vehicle({}).validateSync());
  assert.equal(o.status, 422);
  assert.equal(o.body.error.code, 'VALIDATION_ERROR');
  assert.equal(o.body.error.fields.plate, 'Plate is required');
  const bad = run(new Vehicle({ plate: 'X', capacityKg: 'abc' }).validateSync());
  assert.equal(bad.body.error.fields.capacityKg, 'Capacity kg has an invalid value');
});

test('duplicate keys become a 409 naming the field', () => {
  const o = run(Object.assign(new Error('E11000 duplicate key'), { code: 11000, keyPattern: { plate: 1 } }));
  assert.equal(o.status, 409);
  assert.equal(o.body.error.code, 'DUPLICATE');
  assert.equal(o.body.error.fields.plate, 'This plate is already in use');
});

test('duplicate keys without field info still give a clean 409', () => {
  const o = run(Object.assign(new Error('E11000 duplicate key error collection: x.y'), { code: 11000 }));
  assert.equal(o.status, 409);
  assert.equal(o.body.error.fields, undefined);
  assert.equal(o.body.error.message, 'That value already exists');
});

test('malformed JSON bodies get a friendly 400', () => {
  const o = run(Object.assign(new Error('Unexpected token'), { type: 'entity.parse.failed' }));
  assert.equal(o.status, 400);
  assert.equal(o.body.error.code, 'BAD_JSON');
});

test('unexpected errors return 500 with a request id and never leak internals', (t) => {
  t.mock.method(console, 'error', () => {});
  const o = run(new Error('secret db password is hunter2'));
  assert.equal(o.status, 500);
  assert.equal(o.body.error.requestId, 'req-123');
  assert.ok(!JSON.stringify(o.body).includes('hunter2'));
});
