import AuditLog from '../models/AuditLog.js';
import { userBranchId } from './scope.js';

// Never lets an audit failure break the request.
export async function audit(req, action, entity, doc, summary = '') {
  try {
    await AuditLog.create({
      user: req.user?._id, userName: req.user?.name, role: req.user?.role,
      branch: doc?.branch ?? userBranchId(req.user) ?? undefined,
      action, entity, entityId: doc?._id, summary: String(summary).slice(0, 200),
    });
  } catch (e) { console.error('audit log failed:', e.message); }
}
