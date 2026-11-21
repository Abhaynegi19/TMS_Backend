import { Router } from 'express';
import AuditLog from '../models/AuditLog.js';
import { need } from '../middleware/auth.js';
import { scopeFilter } from '../utils/scope.js';
import { pageMeta, pageParams } from '../utils/paginate.js';

const r = Router();
r.get('/', need('audit:read'), async (req, res) => {
  const filter = { ...scopeFilter(req) };
  if (req.query.entity) filter.entity = String(req.query.entity);
  const pg = pageParams(req.query);
  const query = AuditLog.find(filter).sort('-createdAt _id').populate('branch', 'code');
  if (!pg) return res.json({ data: await query.limit(200) });
  const [total, rows] = await Promise.all([AuditLog.countDocuments(filter), query.skip(pg.skip).limit(pg.limit)]);
  res.json({ data: rows, meta: pageMeta(pg, total) });
});
export default r;
