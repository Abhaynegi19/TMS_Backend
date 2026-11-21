import { Router } from 'express';
import { need } from '../middleware/auth.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { can, ROLE_LABELS } from '../utils/permissions.js';
import { audit } from '../utils/audit.js';
import { DATASETS, MAX_ROWS } from '../reports/datasets.js';
import { stamp, toCsv, toXlsx, XLSX_TYPE } from '../services/reports.js';

const r = Router();
const available = (user) => DATASETS.filter((d) => can(user, d.perm));
const FILTERS = ['q', 'status', 'category', 'trip', 'from', 'to'];
const filtersOf = (query) => Object.fromEntries(FILTERS.filter((k) => query[k] !== undefined && query[k] !== '').map((k) => [k, String(query[k])]));
const send = (res, name, type, body, rows) => {
  res.set({ 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store', 'X-Report-Rows': String(rows), 'X-Report-Truncated': String(rows >= MAX_ROWS) });
  res.send(body);
};

r.get('/', need('reports:export'), (req, res) => {
  res.json({ data: available(req.user).map(({ key, label, description }) => ({ key, label, description })) });
});

// Everything the caller may export, as a single workbook with one sheet per report. Only the date range applies.
r.get('/all', need('reports:export'), async (req, res) => {
  if (req.query.format && req.query.format !== 'xlsx') throw badRequest('The combined report is only available as an Excel workbook (xlsx)');
  const f = filtersOf({ from: req.query.from, to: req.query.to });
  const sheets = [];
  let total = 0;
  for (const ds of available(req.user)) {
    const rows = await ds.rows(req, f);
    total += rows.length;
    sheets.push({ name: ds.label, columns: ds.columns, rows });
  }
  await audit(req, 'export', 'Report', {}, `all reports: ${sheets.length} sheets, ${total} rows`);
  send(res, `haulwise-all-reports-${stamp()}.xlsx`, XLSX_TYPE, await toXlsx(sheets), total);
});

r.get('/:name', need('reports:export'), async (req, res) => {
  const ds = DATASETS.find((d) => d.key === req.params.name);
  if (!ds) throw notFound('Report');
  if (!can(req.user, ds.perm)) throw forbidden(`Your role (${ROLE_LABELS[req.user.role]}) can't export ${ds.label.toLowerCase()}`);
  const format = String(req.query.format || 'xlsx');
  if (!['xlsx', 'csv'].includes(format)) throw badRequest('"format" must be xlsx or csv');
  const rows = await ds.rows(req, filtersOf(req.query));
  await audit(req, 'export', 'Report', {}, `${ds.key}: ${rows.length} rows (${format})`);
  const base = `haulwise-${ds.key}-${stamp()}`;
  if (format === 'csv') send(res, `${base}.csv`, 'text/csv; charset=utf-8', toCsv(ds.columns, rows), rows.length);
  else send(res, `${base}.xlsx`, XLSX_TYPE, await toXlsx([{ name: ds.label, columns: ds.columns, rows }]), rows.length);
});

export default r;
