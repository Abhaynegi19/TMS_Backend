import mongoose from 'mongoose';
import Branch from '../models/Branch.js';
import { badRequest, forbidden, invalid, rule } from './errors.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));
export const userBranchId = (u) => (u.branch?._id ?? u.branch) || null;

export const assertId = (id, label = 'record') => {
  if (!mongoose.isValidObjectId(id)) throw badRequest(`Invalid ${label.toLowerCase()} id`);
};

// Super admins may narrow their view with the X-Branch header; everyone else is pinned to their own branch.
export const selectedBranch = (req) => {
  const b = req.get('x-branch');
  if (!b || b === 'all') return null;
  if (!mongoose.isValidObjectId(b)) throw badRequest('Invalid branch selected');
  return oid(b);
};

export const activeBranchId = (req) => {
  if (req.user.role === 'super_admin') return selectedBranch(req);
  const id = userBranchId(req.user);
  if (!id) throw forbidden('Your account is not assigned to a branch. Ask an administrator to fix this.');
  return id;
};

export const scopeFilter = (req) => {
  const b = activeBranchId(req);
  return b ? { branch: b } : {};
};

// Trips are visible to their owning branch and to the destination branch; drivers only see their own trips.
export const tripScope = (req) => {
  const u = req.user;
  if (u.role === 'driver') return u.driverProfile ? { driver: u.driverProfile } : { _id: { $in: [] } };
  const b = activeBranchId(req);
  return b ? { $or: [{ branch: b }, { destinationBranch: b }] } : {};
};

export async function resolveTargetBranch(req) {
  const id = req.user.role === 'super_admin' ? req.body.branch || selectedBranch(req) : userBranchId(req.user);
  if (!id) throw invalid({ branch: 'Select a branch' }, 'Choose which branch this belongs to');
  if (!mongoose.isValidObjectId(id)) throw invalid({ branch: 'Invalid branch' });
  const b = await Branch.findById(id);
  if (!b) throw invalid({ branch: 'Branch not found' });
  if (!b.isActive) throw rule(`Branch "${b.name}" is inactive. Reactivate it before adding records.`, { branch: 'Branch is inactive' });
  return b;
}
