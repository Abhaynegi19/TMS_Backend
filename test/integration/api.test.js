// End-to-end API tests: roles, branch isolation, dispatch rules, tracking, invoices. They WIPE their own test database.
import http from 'node:http';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { io as ioc } from 'socket.io-client';
import { initRealtime, closeRealtime } from '../../src/realtime.js';
import Branch from '../../src/models/Branch.js';
import User from '../../src/models/User.js';
import Vehicle from '../../src/models/Vehicle.js';
import Driver from '../../src/models/Driver.js';
import Trip from '../../src/models/Trip.js';
import LocationPing from '../../src/models/LocationPing.js';
import { fiscalYear } from '../../src/utils/gst.js';
import { app, mongoose, W, call, newTrip, setStatus, wipe, buildWorld, connectTestDb, tomorrow, sleep, binary, PW } from './world.js';

const skipReason = await connectTestDb('api');

describe('first-run setup', { skip: skipReason }, () => {
  before(wipe);
  it('is needed when there are no users', async () => {
    assert.equal((await call('get', '/api/auth/setup-needed')).body.data.needed, true);
  });
  it('validates every field', async () => {
    let r = await call('post', '/api/auth/setup', null, {});
    assert.equal(r.status, 422);
    for (const k of ['name', 'email', 'password', 'branchName', 'branchCode']) assert.ok(r.body.error.fields[k], k);
    r = await call('post', '/api/auth/setup', null, { name: 'A', email: 'a@b.co', password: 'weakpass', branchName: 'HQ', branchCode: 'TOOLONGCODE' });
    assert.equal(r.status, 422);
    assert.ok(r.body.error.fields.password);
  });
  it('rejects a bad branch code and leaves nothing behind', async () => {
    const r = await call('post', '/api/auth/setup', null, { name: 'A', email: 'a@b.co', password: PW, branchName: 'HQ', branchCode: 'TOOLONGCODE' });
    assert.equal(r.status, 422);
    assert.ok(r.body.error.fields.branchCode);
    assert.equal(await Branch.countDocuments(), 0);
  });
  it('creates the head office and first Super Admin, then locks itself', async () => {
    const r = await call('post', '/api/auth/setup', null, { name: 'Boss', email: 'boss@t.test', password: PW, branchName: 'HQ', branchCode: 'hq' });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.user.role, 'super_admin');
    assert.equal(r.body.data.user.branch.code, 'HQ');
    assert.ok(r.body.data.token);
    assert.equal((await call('get', '/api/auth/setup-needed')).body.data.needed, false);
    const again = await call('post', '/api/auth/setup', null, { name: 'X', email: 'x@t.test', password: PW, branchName: 'B', branchCode: 'B2' });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'ALREADY_SETUP');
  });
});

describe('API', { skip: skipReason }, () => {
  before(buildWorld);
  after(async () => { await closeRealtime(); await mongoose.disconnect(); });

  describe('authentication', () => {
    it('rejects a wrong password with a generic message', async () => {
      const r = await call('post', '/api/auth/login', null, { email: 'admin@t.test', password: 'nope' });
      assert.equal(r.status, 401);
      assert.equal(r.body.error.code, 'INVALID_CREDENTIALS');
    });
    it('reports missing credentials per field', async () => {
      const r = await call('post', '/api/auth/login', null, {});
      assert.equal(r.status, 422);
      assert.ok(r.body.error.fields.email && r.body.error.fields.password);
    });
    it('blocks deactivated accounts', async () => {
      await User.updateOne({ _id: W.users.dispMum._id }, { isActive: false });
      const r = await call('post', '/api/auth/login', null, { email: 'disp.mum@t.test', password: PW });
      assert.equal(r.status, 403);
      assert.equal(r.body.error.code, 'ACCOUNT_DISABLED');
      await User.updateOne({ _id: W.users.dispMum._id }, { isActive: true });
    });
    it('requires a token, and rejects a bad one', async () => {
      assert.equal((await call('get', '/api/vehicles')).body.error.code, 'UNAUTHENTICATED');
      const r = await call('get', '/api/vehicles', 'garbage');
      assert.equal(r.status, 401);
      assert.equal(r.body.error.code, 'TOKEN_INVALID');
    });
    it('returns the session with permissions', async () => {
      const r = await call('get', '/api/auth/me', W.t.dispDel);
      assert.equal(r.body.data.user.role, 'dispatcher');
      assert.ok(r.body.data.user.permissions.includes('trips:write'));
      assert.ok(!r.body.data.user.permissions.includes('users:write'));
    });
    it('validates password changes', async () => {
      let r = await call('put', '/api/auth/password', W.t.acctDel, { currentPassword: 'wrong', newPassword: 'NewPassw0rd' });
      assert.equal(r.status, 422);
      assert.ok(r.body.error.fields.currentPassword);
      r = await call('put', '/api/auth/password', W.t.acctDel, { currentPassword: PW, newPassword: 'short' });
      assert.ok(r.body.error.fields.newPassword);
    });
  });

  describe('role permissions', () => {
    it('dispatchers cannot create users', async () => {
      const r = await call('post', '/api/users', W.t.dispDel, { name: 'X', email: 'x@t.test', password: PW, role: 'driver' });
      assert.equal(r.status, 403);
      assert.equal(r.body.error.code, 'FORBIDDEN');
    });
    it('accountants cannot create vehicles', async () => {
      assert.equal((await call('post', '/api/vehicles', W.t.acctDel, { plate: 'ZZ99' })).status, 403);
    });
    it('drivers cannot list vehicles or open the dashboard', async () => {
      assert.equal((await call('get', '/api/vehicles', W.t.drv1)).status, 403);
      assert.equal((await call('get', '/api/dashboard', W.t.drv1)).status, 403);
    });
    it('only super admins manage branches', async () => {
      assert.equal((await call('post', '/api/branches', W.t.mgrDel, { name: 'X', code: 'XX' })).status, 403);
      let r = await call('post', '/api/branches', W.t.admin, { name: 'X', code: 'x' });
      assert.equal(r.status, 422);
      assert.ok(r.body.error.fields.code);
      r = await call('post', '/api/branches', W.t.admin, { name: 'Dup', code: 'DEL' });
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, 'DUPLICATE');
    });
    it('managers cannot create super admins', async () => {
      const r = await call('post', '/api/users', W.t.mgrDel, { name: 'X', email: 'x@t.test', password: PW, role: 'super_admin' });
      assert.equal(r.status, 403);
    });
    it('managers create staff pinned to their own branch', async () => {
      const r = await call('post', '/api/users', W.t.mgrDel, { name: 'New Disp', email: 'new@t.test', password: PW, role: 'dispatcher', branch: String(W.mum._id) });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.data.branch.code, 'DEL');
      assert.equal(r.body.data.password, undefined);
    });
    it('validates new users, including driver links', async () => {
      let r = await call('post', '/api/users', W.t.mgrDel, { name: 'X', email: 'bad', password: 'weak', role: 'dispatcher' });
      assert.equal(r.status, 422);
      assert.ok(r.body.error.fields.email && r.body.error.fields.password);
      r = await call('post', '/api/users', W.t.mgrDel, { name: 'D', email: 'd@t.test', password: PW, role: 'driver' });
      assert.equal(r.status, 422);
      assert.ok(r.body.error.fields.driverProfile);
    });
    it('users cannot deactivate themselves', async () => {
      const r = await call('put', `/api/users/${W.users.mgrDel._id}`, W.t.mgrDel, { isActive: false });
      assert.equal(r.status, 422);
      assert.equal(r.body.error.code, 'BUSINESS_RULE');
    });
    it('managers cannot see super admins', async () => {
      const r = await call('get', '/api/users', W.t.mgrDel);
      assert.ok(!r.body.data.some((u) => u.role === 'super_admin'));
    });
  });

  describe('branch isolation', () => {
    it('lists only the caller\'s branch', async () => {
      const del = (await call('get', '/api/vehicles', W.t.mgrDel)).body.data.map((v) => v.plate).sort();
      assert.deepEqual(del, ['DL01', 'DL02', 'DL03']);
      const mum = (await call('get', '/api/vehicles', W.t.dispMum)).body.data.map((v) => v.plate);
      assert.deepEqual(mum, ['MH01']);
    });
    it('treats other branches\' records as not found', async () => {
      const r = await call('put', `/api/vehicles/${W.vMum._id}`, W.t.mgrDel, { notes: 'hack' });
      assert.equal(r.status, 404);
    });
    it('lets super admins see everything and narrow with X-Branch', async () => {
      assert.equal((await call('get', '/api/vehicles', W.t.admin)).body.data.length, 4);
      assert.equal((await call('get', '/api/vehicles', W.t.admin, undefined, { 'X-Branch': String(W.mum._id) })).body.data.length, 1);
      assert.equal((await call('get', '/api/vehicles', W.t.admin, undefined, { 'X-Branch': 'junk' })).status, 400);
    });
    it('makes super admins choose a branch when creating', async () => {
      let r = await call('post', '/api/vehicles', W.t.admin, { plate: 'NEW1' });
      assert.equal(r.status, 422);
      assert.ok(r.body.error.fields.branch);
      r = await call('post', '/api/vehicles', W.t.admin, { plate: 'NEW1', branch: String(W.mum._id) });
      assert.equal(r.status, 201);
      assert.equal(r.body.data.branch.code, 'MUM');
    });
    it('ignores a branch smuggled into the body by non-admins', async () => {
      const r = await call('post', '/api/vehicles', W.t.dispMum, { plate: 'NEW2', branch: String(W.del._id) });
      assert.equal(r.body.data.branch.code, 'MUM');
    });
  });

  describe('vehicle and driver records', () => {
    it('reports missing fields', async () => {
      const r = await call('post', '/api/vehicles', W.t.mgrDel, {});
      assert.equal(r.status, 422);
      assert.equal(r.body.error.fields.plate, 'Plate is required');
    });
    it('reports duplicates against the right field', async () => {
      const r = await call('post', '/api/vehicles', W.t.mgrDel, { plate: 'dl01' });
      assert.equal(r.status, 409);
      assert.ok(r.body.error.fields.plate);
    });
    it('rejects malformed ids and numbers', async () => {
      assert.equal((await call('put', '/api/vehicles/not-an-id', W.t.mgrDel, {})).status, 400);
      const r = await call('post', '/api/vehicles', W.t.mgrDel, { plate: 'ZZ1', capacityKg: 'lots' });
      assert.equal(r.status, 422);
      assert.ok(r.body.error.fields.capacityKg);
    });
    it('does not let users set "on-trip" by hand', async () => {
      const r = await call('put', `/api/vehicles/${W.v2._id}`, W.t.mgrDel, { status: 'on-trip' });
      assert.equal(r.status, 422);
      assert.equal(r.body.error.code, 'BUSINESS_RULE');
    });
  });

  describe('trip rules and lifecycle', () => {
    const state = {};
    it('requires the core fields', async () => {
      const r = await call('post', '/api/trips', W.t.dispDel, {});
      assert.equal(r.status, 422);
      for (const k of ['customer', 'origin', 'destination', 'scheduledAt']) assert.ok(r.body.error.fields[k], k);
    });
    it('rejects overloaded cargo, maintenance vehicles, expired licenses and other branches\' vehicles', async () => {
      const post = (extra) => call('post', '/api/trips', W.t.dispDel, { customer: 'A', origin: 'B', destination: 'C', scheduledAt: tomorrow(), ...extra });
      let r = await post({ vehicle: String(W.v2._id), cargoWeightKg: 3000 });
      assert.equal(r.status, 422);
      assert.match(r.body.error.fields.cargoWeightKg, /exceeds/);
      r = await post({ vehicle: String(W.vMaint._id) });
      assert.match(r.body.error.fields.vehicle, /maintenance/);
      r = await post({ driver: String(W.dExpired._id) });
      assert.match(r.body.error.fields.driver, /expired/);
      r = await post({ vehicle: String(W.vMum._id) });
      assert.match(r.body.error.fields.vehicle, /different branch/);
    });
    it('creates trips with a branch-prefixed number', async () => {
      state.t1 = await newTrip({ vehicle: String(W.v1._id), driver: String(W.d1._id), cargoWeightKg: 5000, fare: 10000, distanceKm: 200 });
      assert.match(state.t1.tripNo, /^TRP-DEL-\d{5}$/);
      assert.equal(state.t1.status, 'planned');
    });
    it('cannot start without a vehicle and driver', async () => {
      const bare = await newTrip();
      const r = await setStatus(bare._id, 'in-transit', W.t.dispDel);
      assert.equal(r.status, 422);
      assert.ok(r.body.error.fields.vehicle && r.body.error.fields.driver);
    });
    it('starting marks the vehicle and driver as on-trip', async () => {
      const r = await setStatus(state.t1._id, 'in-transit', W.t.dispDel);
      assert.equal(r.status, 200);
      assert.equal((await Vehicle.findById(W.v1._id)).status, 'on-trip');
      assert.equal((await Driver.findById(W.d1._id)).status, 'on-trip');
      assert.ok(r.body.data.startedAt);
    });
    it('a busy vehicle cannot start a second trip', async () => {
      const t2 = await newTrip({ vehicle: String(W.v1._id), driver: String(W.d2._id) });
      const r = await setStatus(t2._id, 'in-transit', W.t.dispDel);
      assert.equal(r.status, 422);
      assert.match(r.body.error.fields.vehicle, /already on another trip/);
      state.t2 = t2;
    });
    it('rejects invalid status jumps, locked edits and deleting trips in transit', async () => {
      let r = await setStatus(state.t1._id, 'planned', W.t.dispDel);
      assert.equal(r.status, 422);
      assert.match(r.body.error.message, /can't become/);
      r = await call('put', `/api/trips/${state.t1._id}`, W.t.dispDel, { vehicle: String(W.v2._id) });
      assert.equal(r.status, 422);
      r = await call('delete', `/api/trips/${state.t1._id}`, W.t.mgrDel);
      assert.equal(r.status, 409);
    });
    it('completing frees the vehicle and driver and closes the trip', async () => {
      const r = await setStatus(state.t1._id, 'completed', W.t.dispDel);
      assert.equal(r.status, 200);
      assert.ok(r.body.data.completedAt);
      assert.equal((await Vehicle.findById(W.v1._id)).status, 'available');
      assert.equal((await Driver.findById(W.d1._id)).status, 'available');
      assert.equal((await call('put', `/api/trips/${state.t1._id}`, W.t.dispDel, { customer: 'Z' })).status, 422);
      assert.match((await setStatus(state.t1._id, 'cancelled', W.t.dispDel)).body.error.message, /already completed/);
    });
    it('dispatchers cannot delete trips, managers can', async () => {
      const t = await newTrip();
      assert.equal((await call('delete', `/api/trips/${t._id}`, W.t.dispDel)).status, 403);
      assert.equal((await call('delete', `/api/trips/${t._id}`, W.t.mgrDel)).status, 200);
    });
    it('vehicles with open trips cannot be deleted', async () => {
      const r = await call('delete', `/api/vehicles/${W.v1._id}`, W.t.mgrDel);
      assert.equal(r.status, 409); // t2 is still planned on v1
      assert.match(r.body.error.message, /open trip/);
    });
    it('branches with data cannot be deleted', async () => {
      assert.equal((await call('delete', `/api/branches/${W.del._id}`, W.t.admin)).status, 409);
    });
    it('destination branches see incoming trips read-only', async () => {
      const t = await newTrip({ destinationBranch: String(W.mum._id) });
      const list = await call('get', '/api/trips', W.t.dispMum);
      assert.ok(list.body.data.some((x) => x._id === t._id));
      assert.equal((await call('put', `/api/trips/${t._id}`, W.t.dispMum, { customer: 'hack' })).status, 404);
    });
    it('hides trips from unrelated branches', async () => {
      const list = await call('get', '/api/trips', W.t.dispMum);
      assert.ok(list.body.data.every((x) => x.branch.code === 'MUM' || x.destinationBranch?.code === 'MUM'));
    });
    after(() => { W.state = state; });
  });

  describe('payments and invoices', () => {
    it('only roles with payment access can change it', async () => {
      const id = W.state.t1._id;
      assert.equal((await call('patch', `/api/trips/${id}/payment`, W.t.dispDel, { paymentStatus: 'paid' })).status, 403);
      assert.equal((await call('patch', `/api/trips/${id}/payment`, W.t.acctDel, { paymentStatus: 'bogus' })).status, 422);
      const r = await call('patch', `/api/trips/${id}/payment`, W.t.acctDel, { paymentStatus: 'paid' });
      assert.equal(r.status, 200);
      assert.equal(r.body.data.paymentStatus, 'paid');
    });
    it('refuses invoices for trips that are not completed', async () => {
      const r = await call('get', `/api/trips/${W.state.t2._id}/invoice`, W.t.acctDel);
      assert.equal(r.status, 422);
      assert.match(r.body.error.message, /completed/);
    });
    it('lets accountants download a PDF with a stable invoice number', async () => {
      const get = () => call('get', `/api/trips/${W.state.t1._id}/invoice`, W.t.acctDel).buffer(true).parse(binary);
      const r = await get();
      assert.equal(r.status, 200);
      assert.match(r.headers['content-type'], /application\/pdf/);
      assert.match(r.headers['content-disposition'], new RegExp(`DEL-${fiscalYear()}-00001\\.pdf`));
      assert.equal(r.body.subarray(0, 5).toString(), '%PDF-');
      const again = await get();
      assert.match(again.headers['content-disposition'], new RegExp(`DEL-${fiscalYear()}-00001\\.pdf`));
      assert.equal((await Trip.findById(W.state.t1._id)).invoiceNo, `DEL/${fiscalYear()}/00001`);
    });
    it('keeps invoices away from dispatchers and other branches', async () => {
      assert.equal((await call('get', `/api/trips/${W.state.t1._id}/invoice`, W.t.dispDel)).status, 403);
      assert.equal((await call('get', `/api/trips/${W.state.t1._id}/invoice`, W.t.mgrMum)).status, 404);
    });
  });

  describe('driver access', () => {
    const state = {};
    before(async () => {
      state.mine = await newTrip({ vehicle: String(W.v1._id), driver: String(W.d1._id) });
      state.theirs = await newTrip({ vehicle: String(W.v2._id), driver: String(W.d2._id) });
      // free the vehicle/driver from the earlier planned trip so this one can start
      await Trip.updateOne({ _id: W.state.t2._id }, { status: 'cancelled' });
    });
    it('only lists their own trips', async () => {
      const r = await call('get', '/api/trips', W.t.drv1);
      assert.ok(r.body.data.length > 0);
      assert.ok(r.body.data.every((t) => t.driver?._id === String(W.d1._id)));
    });
    it('cannot touch another driver\'s trip', async () => {
      assert.equal((await setStatus(state.theirs._id, 'in-transit', W.t.drv1)).status, 404);
    });
    it('can start their own trip but not cancel or create trips', async () => {
      assert.equal((await setStatus(state.mine._id, 'in-transit', W.t.drv1)).status, 200);
      assert.equal((await setStatus(state.mine._id, 'cancelled', W.t.drv1)).status, 403);
      assert.equal((await call('post', '/api/trips', W.t.drv1, { customer: 'a', origin: 'b', destination: 'c', scheduledAt: tomorrow() })).status, 403);
      W.live = state.mine;
    });
  });

  describe('live tracking', () => {
    it('stores a driver\'s location and updates the trip', async () => {
      const r = await call('post', `/api/trips/${W.live._id}/location`, W.t.drv1, { lat: 28.61, lng: 77.21, speed: 50, heading: 120, accuracy: 8 });
      assert.equal(r.status, 201);
      const t = await Trip.findById(W.live._id);
      assert.equal(t.lastLocation.lat, 28.61);
      assert.equal(await LocationPing.countDocuments({ trip: W.live._id }), 1);
    });
    it('limits how often updates can be sent', async () => {
      const r = await call('post', `/api/trips/${W.live._id}/location`, W.t.drv1, { lat: 28.62, lng: 77.22 });
      assert.equal(r.status, 429);
      assert.equal(r.body.error.code, 'RATE_LIMITED');
    });
    it('rejects impossible coordinates', async () => {
      const r = await call('post', `/api/trips/${W.live._id}/location`, W.t.drv1, { lat: 120, lng: 77 });
      assert.equal(r.status, 422);
      assert.ok(r.body.error.fields.lat);
    });
    it('only accepts readings from the assigned driver while in transit', async () => {
      assert.equal((await call('post', `/api/trips/${W.live._id}/location`, W.t.drv2, { lat: 1, lng: 1 })).status, 404);
      assert.equal((await call('post', `/api/trips/${W.live._id}/location`, W.t.dispDel, { lat: 1, lng: 1 })).status, 403);
      const planned = await newTrip({ driver: String(W.d2._id) });
      const r = await call('post', `/api/trips/${planned._id}/location`, W.t.drv2, { lat: 1, lng: 1 });
      assert.equal(r.status, 422);
      assert.match(r.body.error.message, /in transit/);
    });
    it('shows live trips to managers and dispatchers only, scoped by branch', async () => {
      const r = await call('get', '/api/tracking/live', W.t.mgrDel);
      assert.equal(r.status, 200);
      const hit = r.body.data.find((t) => t._id === W.live._id);
      assert.equal(hit.lastLocation.lat, 28.61);
      assert.equal(hit.vehicle.plate, 'DL01');
      assert.equal((await call('get', '/api/tracking/live', W.t.acctDel)).status, 403);
      assert.equal((await call('get', '/api/tracking/live', W.t.drv1)).status, 403);
      assert.equal((await call('get', '/api/tracking/live', W.t.mgrMum)).body.data.length, 0);
    });
    it('returns the breadcrumb trail', async () => {
      const r = await call('get', `/api/tracking/trail/${W.live._id}`, W.t.dispDel);
      assert.equal(r.status, 200);
      assert.equal(r.body.data.points.length, 1);
      assert.equal((await call('get', `/api/tracking/trail/${W.live._id}`, W.t.mgrMum)).status, 404);
    });

    it('pushes positions over the socket to the right branch only', async () => {
      const server = http.createServer(app);
      initRealtime(server);
      await new Promise((r) => server.listen(0, r));
      const url = `http://127.0.0.1:${server.address().port}`;
      const connect = (token) => new Promise((resolve, reject) => {
        const s = ioc(url, { auth: { token }, transports: ['websocket'], reconnection: false });
        s.on('connect', () => resolve(s));
        s.on('connect_error', (e) => { s.close(); reject(e); });
      });
      const refused = async (token) => { try { (await connect(token)).close(); } catch (e) { return e; } assert.fail('expected the connection to be refused'); };
      try {
        assert.equal((await refused(W.t.acctDel)).data.code, 'FORBIDDEN');
        assert.equal((await refused('garbage')).data.code, 'TOKEN_INVALID');
        const mgr = await connect(W.t.mgrDel);
        const mum = await connect(W.t.mgrMum);
        const got = new Promise((res) => mgr.once('trip:location', res));
        let leaked = false;
        mum.on('trip:location', () => { leaked = true; });
        await Trip.updateOne({ _id: W.live._id }, { 'lastLocation.at': new Date(Date.now() - 10000) });
        const r = await call('post', `/api/trips/${W.live._id}/location`, W.t.drv1, { lat: 27.5, lng: 77.7, speed: 62 });
        assert.equal(r.status, 201);
        const msg = await Promise.race([got, sleep(3000).then(() => null)]);
        assert.ok(msg, 'manager should receive the update');
        assert.equal(msg.lat, 27.5);
        assert.equal(msg.plate, 'DL01');
        await sleep(300);
        assert.equal(leaked, false, 'other branches must not receive it');
        mgr.close(); mum.close();
      } finally { await closeRealtime(); }
    });
  });

  describe('dashboard and audit log', () => {
    it('summarises the branch for managers', async () => {
      const r = await call('get', '/api/dashboard', W.t.mgrDel);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.ok(r.body.data.trips.completed >= 1);
      assert.equal(r.body.data.months.length, 6);
      assert.equal(r.body.data.byBranch, null);
    });
    it('shows super admins a per-branch breakdown', async () => {
      const r = await call('get', '/api/dashboard', W.t.admin);
      assert.equal(r.body.data.byBranch.length, 2);
    });
    it('records actions and limits who can read them', async () => {
      const r = await call('get', '/api/audit', W.t.mgrDel);
      assert.equal(r.status, 200);
      assert.ok(r.body.data.length > 0);
      assert.ok(r.body.data.every((a) => a.branch?.code === 'DEL'));
      assert.ok(r.body.data.some((a) => a.action === 'invoice'));
      assert.equal((await call('get', '/api/audit', W.t.dispDel)).status, 403);
    });
  });

  it('returns JSON for unknown endpoints and bad bodies', async () => {
    assert.equal((await call('get', '/api/nope', W.t.admin)).body.error.code, 'NOT_FOUND');
    const r = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{oops');
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'BAD_JSON');
  });
});
