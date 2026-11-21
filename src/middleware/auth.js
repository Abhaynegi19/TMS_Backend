import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { AppError, forbidden, unauthenticated } from '../utils/errors.js';
import { can, ROLE_LABELS } from '../utils/permissions.js';

export async function protect(req, _res, next) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) throw unauthenticated();
  let payload;
  try {
    payload = jwt.verify(h.slice(7), process.env.JWT_SECRET);
  } catch (e) {
    if (e.name === 'TokenExpiredError') throw unauthenticated('Your session has expired. Please sign in again.', 'TOKEN_EXPIRED');
    throw unauthenticated('Your session is invalid. Please sign in again.', 'TOKEN_INVALID');
  }
  const user = await User.findById(payload.id).populate('branch', 'name code isActive');
  if (!user) throw unauthenticated('This account no longer exists.', 'TOKEN_INVALID');
  if (!user.isActive) throw new AppError(403, 'ACCOUNT_DISABLED', 'Your account has been deactivated. Contact your administrator.');
  if (user.role !== 'super_admin' && user.branch && !user.branch.isActive) {
    throw new AppError(403, 'BRANCH_INACTIVE', `Your branch (${user.branch.name}) is inactive. Contact head office.`);
  }
  req.user = user;
  next();
}

export const ensure = (req, perm) => {
  if (!can(req.user, perm)) throw forbidden(`Your role (${ROLE_LABELS[req.user.role]}) isn't allowed to do this`);
};
export const need = (perm) => (req, _res, next) => {
  try { ensure(req, perm); next(); } catch (e) { next(e); }
};
