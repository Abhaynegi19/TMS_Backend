import Vehicle from '../models/Vehicle.js';
import Driver from '../models/Driver.js';
import User from '../models/User.js';
import AlertLog from '../models/AlertLog.js';
import { vehicleAlerts, driverAlerts, sortAlerts } from '../utils/alertRules.js';
import { esc, mailMode, sendMail } from '../utils/mailer.js';

export async function currentAlerts({ branchId = null, now = new Date(), horizon = 30 } = {}) {
  const f = branchId ? { branch: branchId } : {};
  const [vehicles, drivers] = await Promise.all([
    Vehicle.find(f).populate('branch', 'name code email'), Driver.find(f).populate('branch', 'name code email'),
  ]);
  return sortAlerts([...vehicles.flatMap((v) => vehicleAlerts(v, now, horizon)), ...drivers.flatMap((d) => driverAlerts(d, now, horizon))]);
}

const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
export const describe = (a) => {
  if (a.kind === 'service-km') return a.remainingKm <= 0 ? `${-a.remainingKm} km overdue` : `${a.remainingKm} km left`;
  if (a.days < 0) return `expired ${-a.days} day${a.days === -1 ? '' : 's'} ago (${fmtDate(a.dueOn)})`;
  return a.days === 0 ? 'due today' : `due in ${a.days} day${a.days === 1 ? '' : 's'} (${fmtDate(a.dueOn)})`;
};

function digest(branch, items) {
  const tag = { expired: 'OVERDUE', soon: 'SOON', upcoming: 'UPCOMING' };
  const text = [`${branch.name}: ${items.length} reminder${items.length > 1 ? 's' : ''}`, '', ...items.map((a) => `- [${tag[a.severity]}] ${a.label}: ${a.subject}, ${describe(a)}`), '', 'Sent by Haulwise.'].join('\n');
  const color = { expired: '#9a2a1f', soon: '#7a5600', upcoming: '#1b4a9c' };
  const rows = items.map((a) => `<tr><td style="padding:6px 10px;color:${color[a.severity]};font-weight:bold">${tag[a.severity]}</td><td style="padding:6px 10px">${esc(a.label)}</td><td style="padding:6px 10px"><b>${esc(a.subject)}</b></td><td style="padding:6px 10px">${esc(describe(a))}</td></tr>`).join('');
  return {
    subject: `${branch.name}: ${items.length} document/service reminder${items.length > 1 ? 's' : ''}`, text,
    html: `<p><b>${esc(branch.name)}</b> has ${items.length} reminder${items.length > 1 ? 's' : ''}:</p><table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">${rows}</table><p style="color:#666">Sent by Haulwise.</p>`,
  };
}

// Emails one digest per branch (to its managers and the branch address), only for reminders not already sent at this stage.
export async function runAlertSweep({ branchId = null, now = new Date(), send = sendMail } = {}) {
  const mode = mailMode();
  const alerts = await currentAlerts({ branchId, now });
  const done = new Set((await AlertLog.find({ key: { $in: alerts.map((a) => a.key) }, mode }).select('key')).map((x) => x.key));
  const fresh = alerts.filter((a) => !done.has(a.key));
  const groups = new Map();
  for (const a of fresh) {
    const id = String(a.branch?._id);
    if (!groups.has(id)) groups.set(id, { branch: a.branch, items: [] });
    groups.get(id).items.push(a);
  }
  const results = [];
  for (const { branch, items } of groups.values()) {
    const managers = await User.find({ branch: branch._id, role: 'branch_manager', isActive: true }).select('email');
    const to = [...new Set([...managers.map((u) => u.email), branch.email].filter(Boolean))];
    const base = { branch: branch.code, alerts: items.length, recipients: to };
    if (!to.length) { results.push({ ...base, sent: false, reason: 'No recipients. Add a branch manager or a branch email address.' }); continue; }
    try {
      await send({ to, ...digest(branch, items) });
      await AlertLog.insertMany(items.map((a) => ({ key: a.key, mode, branch: branch._id })), { ordered: false }).catch(() => {});
      results.push({ ...base, sent: true });
    } catch (e) {
      results.push({ ...base, sent: false, reason: `Email failed: ${e.message}` });
    }
  }
  return { checked: alerts.length, newAlerts: fresh.length, branches: results, mailMode: mode };
}

// Checks every 6 hours. Dedupe means a given reminder is emailed once per stage, not once per check.
export function startAlertScheduler() {
  if (process.env.ALERTS_ENABLED === 'false' || process.env.NODE_ENV === 'test') return () => {};
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runAlertSweep();
      if (r.newAlerts) console.log(`[alerts] ${r.newAlerts} new reminder(s); ${r.branches.filter((b) => b.sent).length} branch digest(s) sent (${r.mailMode})`);
    } catch (e) { console.error('[alerts] sweep failed:', e.message); } finally { running = false; }
  };
  const first = setTimeout(tick, 30000);
  const every = setInterval(tick, 6 * 3600 * 1000);
  first.unref(); every.unref();
  return () => { clearTimeout(first); clearInterval(every); };
}
