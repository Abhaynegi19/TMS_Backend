import { Router } from 'express';
import User from '../models/User.js';
import Driver from '../models/Driver.js';
import { need } from '../middleware/auth.js';
import { forbidden, invalid, notFound, rule, conflict } from '../utils/errors.js';
import { assignableRoles, ROLES, ROLE_LABELS } from '../utils/permissions.js';
import { assertId, resolveTargetBranch, scopeFilter } from '../utils/scope.js';
import { emailError, failIf, missing, passwordError } from '../utils/validators.js';
import { audit } from '../utils/audit.js';
import { pageMeta, pageParams } from '../utils/paginate.js';

const r = Router();
const POP = [{ path: 'branch', select: 'name code' }, { path: 'driverProfile', select: 'name' }];

// Branch managers can't see or touch Super Admins or users outside their branch.
const visible = (req) => {
  const f = scopeFilter(req);
  if (req.user.role !== 'super_admin') f.role = { $ne: 'super_admin' };
  return f;
};
const toBool = (v) => v === true || v === 'true';

async function checkDriverProfile(id, branchId, selfId) {
  if (!id) throw invalid({ driverProfile: 'Pick the driver record this login belongs to' });
  const d = await Driver.findById(id);
  if (!d) throw invalid({ driverProfile: 'Driver record not found' });
  if (String(d.branch) !== String(branchId)) throw invalid({ driverProfile: 'This driver belongs to a different branch' });
  const taken = await User.findOne({ driverProfile: id, ...(selfId ? { _id: { $ne: selfId } } : {}) });
  if (taken) throw conflict('That driver already has a login', { driverProfile: 'Already linked to another user' });
}

r.get('/', need('users:read'), async (req, res) => {
  const pg = pageParams(req.query);
  const filter = visible(req);
  const query = User.find(filter).populate(POP).sort('name _id');
  if (!pg) return res.json({ data: await query });
  const [total, rows] = await Promise.all([User.countDocuments(filter), query.skip(pg.skip).limit(pg.limit)]);
  res.json({ data: rows, meta: pageMeta(pg, total) });
});

r.post('/', need('users:write'), async (req, res) => {
  const b = req.body;
  const f = missing(b, { name: 'Name', email: 'Email', password: 'Password', role: 'Role' });
  if (!f.email && emailError(b.email)) f.email = emailError(b.email);
  if (!f.password && passwordError(b.password)) f.password = passwordError(b.password);
  if (!f.role && !ROLES.includes(b.role)) f.role = 'Choose a valid role';
  failIf(f);
  if (!assignableRoles(req.user).includes(b.role)) throw forbidden(`You can't create ${ROLE_LABELS[b.role]} accounts`);

  let branch = null;
  if (b.role !== 'super_admin') branch = await resolveTargetBranch(req);
  else if (b.branch) branch = await resolveTargetBranch(req);
  if (b.role === 'driver') await checkDriverProfile(b.driverProfile, branch._id);

  const user = await User.create({
    name: b.name, email: b.email, password: b.password, role: b.role, branch: branch?._id,
    driverProfile: b.role === 'driver' ? b.driverProfile : undefined, isActive: b.isActive === undefined ? true : toBool(b.isActive),
  });
  await audit(req, 'create', 'User', user, `${user.email} (${ROLE_LABELS[user.role]})`);
  res.status(201).json({ data: await User.findById(user._id).populate(POP) });
});

r.put('/:id', need('users:write'), async (req, res) => {
  assertId(req.params.id, 'User');
  const u = await User.findOne({ _id: req.params.id, ...visible(req) });
  if (!u) throw notFound('User');
  const { name, role, isActive, password, driverProfile } = req.body;
  const self = String(u._id) === String(req.user._id);
  const nextRole = role ?? u.role;
  const nextActive = isActive === undefined ? u.isActive : toBool(isActive);

  if (self && (nextRole !== u.role || !nextActive)) throw rule("You can't change your own role or deactivate your own account");
  if (nextRole !== u.role) {
    if (!ROLES.includes(nextRole)) throw invalid({ role: 'Choose a valid role' });
    if (!assignableRoles(req.user).includes(nextRole)) throw forbidden(`You can't assign the ${ROLE_LABELS[nextRole]} role`);
  }
  if (u.role === 'super_admin' && (nextRole !== 'super_admin' || !nextActive)) {
    const others = await User.countDocuments({ role: 'super_admin', isActive: true, _id: { $ne: u._id } });
    if (!others) throw rule('At least one active Super Admin must remain');
  }
  if (password) {
    const pe = passwordError(password);
    if (pe) throw invalid({ password: pe });
    u.password = password;
  }
  if (name !== undefined) u.name = name;
  u.role = nextRole;
  u.isActive = nextActive;
  if (nextRole === 'driver') {
    const dp = driverProfile || u.driverProfile;
    await checkDriverProfile(dp, u.branch, u._id);
    u.driverProfile = dp;
  } else u.driverProfile = undefined;

  await u.save();
  await audit(req, 'update', 'User', u, `${u.email} (${ROLE_LABELS[u.role]})`);
  res.json({ data: await User.findById(u._id).populate(POP) });
});

export default r;
