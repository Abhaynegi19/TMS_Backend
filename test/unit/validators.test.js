import '../setup-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { emailError, passwordError, missing, failIf } from '../../src/utils/validators.js';

test('emailError', () => {
  assert.equal(emailError('a@b.co'), null);
  for (const bad of ['', 'nope', 'a@b', 'a b@c.com', undefined]) assert.ok(emailError(bad), String(bad));
});

test('passwordError enforces length, a letter and a digit', () => {
  assert.equal(passwordError('Passw0rd!'), null);
  assert.match(passwordError('short1'), /at least 8/);
  assert.match(passwordError('onlyletters'), /letter and one number/);
  assert.match(passwordError('12345678'), /letter and one number/);
});

test('missing lists blank fields with labels', () => {
  assert.deepEqual(missing({ name: ' ', email: 'x' }, { name: 'Name', email: 'Email', role: 'Role' }), { name: 'Name is required', role: 'Role is required' });
});

test('failIf throws a 422 with the fields, and passes when empty', () => {
  assert.doesNotThrow(() => failIf({}));
  assert.throws(() => failIf({ a: 'bad' }), (e) => e.status === 422 && e.code === 'VALIDATION_ERROR' && e.fields.a === 'bad');
});
