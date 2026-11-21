import { Router } from 'express';
import Branch from '../models/Branch.js';
import User from '../models/User.js';
import Vehicle from '../models/Vehicle.js';
import Driver from '../models/Driver.js';
import Trip from '../models/Trip.js';
import { ensure, need } from '../middleware/auth.js';
import { conflict, notFound, rule } from '../utils/errors.js';
import { assertId } from '../utils/scope.js';
import { audit } from '../utils/audit.js';
import { pageMeta, pageParams } from '../utils/paginate.js';

const r = Router();
const WRITABLE = ['name', 'code', 'city', 'address', 'phone', 'email', 'gstin', 'stateCode', 'isActive'];
const pick = (b) => Object.fromEntries(WRITABLE.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));

// Super admins see everything; other roles get a light directory of active branches (e.g. for choosing a destination).
r.get('/', async (req, res) => {
  if (req.user.role !== 'super_admin') {
    return res.json({ data: await Branch.find({ isActive: true }).select('name code city').sort('name') });
  }
  const pg = pageParams(req.query);
  if (!pg) return res.json({ data: await Branch.find().sort('name _id') });
  const [total, rows] = await Promise.all([Branch.countDocuments(), Branch.find().sort('name _id').skip(pg.skip).limit(pg.limit)]);
  res.json({ data: rows, meta: pageMeta(pg, total) });
});

r.post('/', need('branches:write'), async (req, res) => {
  const b = await Branch.create(pick(req.body));
  await audit(req, 'create', 'Branch', { _id: b._id, branch: b._id }, `${b.code} ${b.name}`);
  res.status(201).json({ data: b });
});

r.put('/:id', need('branches:write'), async (req, res) => {
  assertId(req.params.id, 'Branch');
  const b = await Branch.findById(req.params.id);
  if (!b) throw notFound('Branch');
  const body = pick(req.body);
  if (body.isActive === false && b.isActive) {
    const n = await Trip.countDocuments({ branch: b._id, status: 'in-transit' });
    if (n) throw rule(`Can't deactivate ${b.name}: ${n} trip${n > 1 ? 's are' : ' is'} still in transit.`, { isActive: 'Trips in transit' });
  }
  b.set(body);
  await b.save();
  await audit(req, 'update', 'Branch', { _id: b._id, branch: b._id }, `${b.code} ${b.name}`);
  res.json({ data: b });
});

r.delete('/:id', async (req, res) => {
  ensure(req, 'branches:delete');
  assertId(req.params.id, 'Branch');
  const b = await Branch.findById(req.params.id);
  if (!b) throw notFound('Branch');
  const [u, v, d, t] = await Promise.all([
    User.countDocuments({ branch: b._id }), Vehicle.countDocuments({ branch: b._id }),
    Driver.countDocuments({ branch: b._id }), Trip.countDocuments({ branch: b._id }),
  ]);
  if (u + v + d + t) {
    throw conflict(`Can't delete ${b.name}: it still has ${u} user(s), ${v} vehicle(s), ${d} driver(s) and ${t} trip(s). Deactivate it instead.`);
  }
  await b.deleteOne();
  await audit(req, 'delete', 'Branch', { _id: b._id }, `${b.code} ${b.name}`);
  res.json({ data: { ok: true } });
});

export default r;
