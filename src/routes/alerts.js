import { Router } from 'express';
import { need } from '../middleware/auth.js';
import { activeBranchId } from '../utils/scope.js';
import { currentAlerts, runAlertSweep } from '../services/alerts.js';
import { audit } from '../utils/audit.js';

const r = Router();
r.get('/', need('alerts:read'), async (req, res) => {
  const list = await currentAlerts({ branchId: activeBranchId(req) });
  res.json({ data: list.map((a) => ({ ...a, branch: a.branch && { _id: a.branch._id, code: a.branch.code, name: a.branch.name } })) });
});
// "Send reminders now": same sweep the scheduler runs, limited to the caller's branch scope.
r.post('/run', need('alerts:run'), async (req, res) => {
  const out = await runAlertSweep({ branchId: activeBranchId(req) });
  await audit(req, 'run', 'Alerts', {}, `${out.newAlerts} new, ${out.branches.filter((b) => b.sent).length} sent`);
  res.json({ data: out });
});
export default r;
