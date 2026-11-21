// Pure rules that decide which documents and services need attention. No database access here.
const DAY = 864e5;
const dayNo = (d) => Math.floor(new Date(d).getTime() / DAY);
export const daysUntil = (date, now = new Date()) => dayNo(date) - dayNo(now);
export const THRESHOLDS = [1, 3, 7, 14, 30]; // ascending: the bucket is the smallest threshold that is still >= days left
export const KM_WARN = 1000;

export const LABELS = {
  license: 'Driving license', insurance: 'Insurance', permit: 'Permit', fitness: 'Fitness certificate', puc: 'Pollution certificate (PUC)',
  'service-date': 'Service due', 'service-km': 'Service due (distance)',
};
const DOC_FIELDS = { insurance: 'insuranceExpiry', permit: 'permitExpiry', fitness: 'fitnessExpiry', puc: 'pucExpiry' };

// The bucket changes as a deadline gets closer (30, 14, 7, 3, 1 days), then weekly once overdue, so each stage is emailed once.
const dateBucket = (days) => (days < 0 ? `overdue-w${Math.floor(-days / 7)}` : days === 0 ? 'today' : `t${THRESHOLDS.find((t) => t >= days) ?? 30}`);
const dateSeverity = (days) => (days < 0 ? 'expired' : days <= 7 ? 'soon' : 'upcoming');
const kmBucket = (rem) => (rem <= 0 ? `over${Math.floor(-rem / 500)}` : rem <= 250 ? 'k250' : rem <= 500 ? 'k500' : 'k1000');

function dateAlert({ kind, subjectType, subjectId, subject, branch, dueOn, now }) {
  const days = daysUntil(dueOn, now);
  const bucket = dateBucket(days);
  return {
    kind, label: LABELS[kind], subjectType, subjectId: String(subjectId), subject, branch, dueOn: new Date(dueOn), days, remainingKm: null,
    severity: dateSeverity(days), bucket, key: `${kind}:${subjectId}:${new Date(dueOn).toISOString().slice(0, 10)}:${bucket}`,
  };
}

export function vehicleAlerts(v, now = new Date(), horizon = 30) {
  const out = [];
  const base = { subjectType: 'vehicle', subjectId: v._id, subject: v.plate, branch: v.branch, now };
  for (const [kind, field] of Object.entries(DOC_FIELDS)) {
    if (v[field] && daysUntil(v[field], now) <= horizon) out.push(dateAlert({ ...base, kind, dueOn: v[field] }));
  }
  if (v.serviceIntervalDays > 0 && v.lastService) {
    const due = new Date(new Date(v.lastService).getTime() + v.serviceIntervalDays * DAY);
    if (daysUntil(due, now) <= horizon) out.push(dateAlert({ ...base, kind: 'service-date', dueOn: due }));
  }
  if (v.serviceIntervalKm > 0) {
    const dueKm = (v.lastServiceKm || 0) + v.serviceIntervalKm;
    const remaining = dueKm - (v.odometerKm || 0);
    if (remaining <= KM_WARN) {
      const bucket = kmBucket(remaining);
      out.push({
        kind: 'service-km', label: LABELS['service-km'], subjectType: 'vehicle', subjectId: String(v._id), subject: v.plate, branch: v.branch,
        dueOn: null, days: null, remainingKm: remaining, severity: remaining <= 0 ? 'expired' : remaining <= 250 ? 'soon' : 'upcoming',
        bucket, key: `service-km:${v._id}:${dueKm}:${bucket}`,
      });
    }
  }
  return out;
}

export function driverAlerts(d, now = new Date(), horizon = 30) {
  if (!d.licenseExpiry || daysUntil(d.licenseExpiry, now) > horizon) return [];
  return [dateAlert({ kind: 'license', subjectType: 'driver', subjectId: d._id, subject: d.name, branch: d.branch, dueOn: d.licenseExpiry, now })];
}

const RANK = { expired: 0, soon: 1, upcoming: 2 };
export const sortAlerts = (list) => [...list].sort((a, b) => RANK[a.severity] - RANK[b.severity] || (a.days ?? 9999) - (b.days ?? 9999) || a.subject.localeCompare(b.subject));
