import { Router } from 'express';
import { need } from '../middleware/auth.js';
import { notFound } from '../utils/errors.js';
import { assertId, resolveTargetBranch, scopeFilter } from '../utils/scope.js';
import { audit } from '../utils/audit.js';
import { pageMeta, pageParams } from '../utils/paginate.js';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// CRUD with per-action permissions, field whitelisting and audit logging.
// scoped:true (default) pins records to a branch. scoped:false is for company-wide data such as customers.
export default function crud({ name, label, Model, populate = 'branch', search = [], writable, before, after, beforeDelete, ident = (d) => d._id, scoped = true, sort = '-createdAt' }) {
  const r = Router();
  const scope = (req) => (scoped ? scopeFilter(req) : {});
  const pick = (b) => Object.fromEntries(writable.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
  const findOwned = async (req) => {
    assertId(req.params.id, label);
    const d = await Model.findOne({ _id: req.params.id, ...scope(req) });
    if (!d) throw notFound(label);
    return d;
  };

  r.get('/', need(`${name}:read`), async (req, res) => {
    const { q, status } = req.query;
    const filter = { ...scope(req) };
    if (status) filter.status = String(status);
    if (q && search.length) filter.$or = search.map((k) => ({ [k]: new RegExp(esc(String(q)), 'i') }));
    const pg = pageParams(req.query);
    const query = Model.find(filter).populate(populate).sort(`${sort} _id`);
    if (!pg) return res.json({ data: await query.limit(500) });
    const [total, rows] = await Promise.all([Model.countDocuments(filter), query.skip(pg.skip).limit(pg.limit)]);
    res.json({ data: rows, meta: pageMeta(pg, total) });
  });

  r.post('/', need(`${name}:write`), async (req, res) => {
    const branch = scoped ? await resolveTargetBranch(req) : null;
    const body = pick(req.body);
    if (before) await before(body, null, req, branch);
    const doc = await Model.create(scoped ? { ...body, branch: branch._id } : body);
    await audit(req, 'create', label, doc, ident(doc));
    if (after) await after(doc, req);
    res.status(201).json({ data: await Model.findById(doc._id).populate(populate) });
  });

  r.put('/:id', need(`${name}:write`), async (req, res) => {
    const doc = await findOwned(req);
    const body = pick(req.body);
    if (before) await before(body, doc, req, doc.branch);
    doc.set(body);
    await doc.save();
    await audit(req, 'update', label, doc, ident(doc));
    if (after) await after(doc, req);
    res.json({ data: await Model.findById(doc._id).populate(populate) });
  });

  r.delete('/:id', need(`${name}:delete`), async (req, res) => {
    const doc = await findOwned(req);
    if (beforeDelete) await beforeDelete(doc);
    await doc.deleteOne();
    await audit(req, 'delete', label, doc, ident(doc));
    res.json({ data: { ok: true } });
  });

  return r;
}
