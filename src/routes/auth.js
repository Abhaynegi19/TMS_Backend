import { Router } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import User from '../models/User.js';
import Branch from '../models/Branch.js';
import { protect } from '../middleware/auth.js';
import { AppError, invalid } from '../utils/errors.js';
import { permissionsFor } from '../utils/permissions.js';
import { emailError, failIf, missing, passwordError } from '../utils/validators.js';

const r = Router();
const sign = (u) => jwt.sign({ id: u._id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '12h' });
export const sessionUser = (u) => ({
  id: u._id, name: u.name, email: u.email, role: u.role,
  branch: u.branch ? { id: u.branch._id ?? u.branch, name: u.branch.name, code: u.branch.code } : null,
  driverProfile: u.driverProfile?._id ?? u.driverProfile ?? null,
  permissions: permissionsFor(u.role),
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true, skip: () => process.env.NODE_ENV === 'test', standardHeaders: true, legacyHeaders: false,
  handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many failed sign-in attempts. Try again in 15 minutes.')),
});

r.get('/setup-needed', async (_req, res) => res.json({ data: { needed: (await User.countDocuments()) === 0 } }));

// First-run only: creates the head-office branch and the first Super Admin.
r.post('/setup', async (req, res) => {
  if ((await User.countDocuments()) > 0) throw new AppError(409, 'ALREADY_SETUP', 'Setup is already complete. Please sign in.');
  const b = req.body;
  const f = missing(b, { name: 'Your name', email: 'Email', password: 'Password', branchName: 'Branch name', branchCode: 'Branch code' });
  if (!f.email && emailError(b.email)) f.email = emailError(b.email);
  if (!f.password && passwordError(b.password)) f.password = passwordError(b.password);
  failIf(f);
  let branch;
  try {
    branch = await Branch.create({ name: b.branchName, code: b.branchCode, city: b.city });
    const user = await User.create({ name: b.name, email: b.email, password: b.password, role: 'super_admin', branch: branch._id });
    const full = await User.findById(user._id).populate('branch', 'name code');
    res.status(201).json({ data: { token: sign(user), user: sessionUser(full) } });
  } catch (e) {
    if (branch && !(await User.exists({ branch: branch._id }))) await Branch.deleteOne({ _id: branch._id });
    if (e.code === 11000 && e.keyPattern?.code) throw invalid({ branchCode: 'This branch code is already in use' });
    if (e.name === 'ValidationError' && e.errors?.code) throw invalid({ branchCode: e.errors.code.message });
    throw e;
  }
});

r.post('/login', loginLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const f = {};
  if (!email) f.email = 'Email is required';
  if (!password) f.password = 'Password is required';
  failIf(f);
  const user = await User.findOne({ email }).select('+password').populate('branch', 'name code isActive');
  if (!user || !(await user.matches(password))) throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
  if (!user.isActive) throw new AppError(403, 'ACCOUNT_DISABLED', 'Your account has been deactivated. Contact your administrator.');
  if (user.role !== 'super_admin' && user.branch && !user.branch.isActive) {
    throw new AppError(403, 'BRANCH_INACTIVE', `Your branch (${user.branch.name}) is inactive. Contact head office.`);
  }
  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });
  res.json({ data: { token: sign(user), user: sessionUser(user) } });
});

r.get('/me', protect, (req, res) => res.json({ data: { user: sessionUser(req.user) } }));

r.put('/password', protect, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const f = missing(req.body, { currentPassword: 'Current password', newPassword: 'New password' });
  if (!f.newPassword && passwordError(newPassword)) f.newPassword = passwordError(newPassword);
  failIf(f);
  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.matches(currentPassword))) throw invalid({ currentPassword: 'Current password is incorrect' });
  if (currentPassword === newPassword) throw invalid({ newPassword: 'New password must be different from the current one' });
  user.password = newPassword;
  await user.save();
  res.json({ data: { ok: true } });
});

export default r;
