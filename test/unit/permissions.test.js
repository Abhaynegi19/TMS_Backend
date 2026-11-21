import '../setup-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { can, assignableRoles, ROLES } from '../../src/utils/permissions.js';

const as = (role) => ({ role });

test('super admin can do everything', () => {
  for (const p of ['branches:write', 'users:write', 'trips:delete', 'anything:else']) assert.ok(can(as('super_admin'), p));
});

test('branch manager manages users but not branches', () => {
  assert.ok(can(as('branch_manager'), 'users:write'));
  assert.ok(can(as('branch_manager'), 'invoices:read'));
  assert.ok(can(as('branch_manager'), 'tracking:read'));
  assert.equal(can(as('branch_manager'), 'branches:write'), false);
});

test('dispatcher plans trips but cannot delete, bill or manage users', () => {
  assert.ok(can(as('dispatcher'), 'trips:write'));
  assert.ok(can(as('dispatcher'), 'tracking:read'));
  for (const p of ['trips:delete', 'trips:payment', 'invoices:read', 'users:read', 'audit:read']) assert.equal(can(as('dispatcher'), p), false, p);
});

test('accountant handles payments and invoices but not dispatch', () => {
  assert.ok(can(as('accountant'), 'trips:payment'));
  assert.ok(can(as('accountant'), 'invoices:read'));
  for (const p of ['trips:write', 'vehicles:write', 'tracking:read', 'customers:write', 'rates:write', 'alerts:run']) assert.equal(can(as('accountant'), p), false, p);
});

test('driver can only read trips, update status and share location', () => {
  for (const p of ['trips:read', 'trips:status', 'trips:location']) assert.ok(can(as('driver'), p), p);
  for (const p of ['trips:write', 'vehicles:read', 'dashboard:read', 'tracking:read']) assert.equal(can(as('driver'), p), false, p);
});

test('unknown roles and missing users have no access', () => {
  assert.equal(can(as('hacker'), 'trips:read'), false);
  assert.equal(can(undefined, 'trips:read'), false);
});

test('branch managers cannot hand out admin-level roles', () => {
  assert.deepEqual(assignableRoles(as('branch_manager')), ['dispatcher', 'accountant', 'driver']);
  assert.deepEqual(assignableRoles(as('super_admin')), ROLES);
});

test('expenses: drivers add, three roles edit, two roles delete', () => {
  const who = { super_admin: 'sa', branch_manager: 'bm', dispatcher: 'dp', accountant: 'ac', driver: 'dr' };
  const allowed = (perm) => Object.keys(who).filter((role) => can(as(role), perm)).sort();
  assert.deepEqual(allowed('expenses:add'), ['accountant', 'branch_manager', 'driver', 'super_admin']);
  assert.deepEqual(allowed('expenses:write'), ['accountant', 'branch_manager', 'super_admin']);
  assert.deepEqual(allowed('expenses:delete'), ['branch_manager', 'super_admin']);
  assert.deepEqual(allowed('expenses:read'), ['accountant', 'branch_manager', 'dispatcher', 'driver', 'super_admin']);
});
