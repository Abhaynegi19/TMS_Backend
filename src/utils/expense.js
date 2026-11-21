import { invalid } from './errors.js';
import { round2 } from './gst.js';

export const CATEGORIES = ['diesel', 'toll', 'parking', 'repair', 'food', 'fine', 'other'];
export const MAX_AMOUNT = 10000000; // a sanity limit that catches typos such as an extra zero
const DAY = 864e5;
const isBlank = (v) => v === undefined || v === null || v === '';

// Validates an expense payload. For updates pass partial:true and the existing record, so only the
// fields that were sent are checked, while rules that span fields (notes for "other", litres for diesel) still hold.
export function parseExpense(b = {}, { partial = false, existing = {}, now = new Date(), tripStart } = {}) {
  const f = {};
  const out = {};

  if (!partial || b.category !== undefined) {
    if (!CATEGORIES.includes(b.category)) f.category = 'Choose a category';
    else out.category = b.category;
  }
  if (!partial || b.amount !== undefined) {
    const n = Number(b.amount);
    if (isBlank(b.amount) || !Number.isFinite(n) || n <= 0) f.amount = 'Enter an amount greater than zero';
    else if (n > MAX_AMOUNT) f.amount = `Amount can't be more than ₹${MAX_AMOUNT.toLocaleString('en-IN')}. Check for an extra zero.`;
    else out.amount = round2(n);
  }
  if (b.date !== undefined && !isBlank(b.date)) {
    const d = new Date(b.date);
    if (Number.isNaN(d.getTime())) f.date = 'Enter a valid date';
    else if (d.getTime() > now.getTime() + DAY) f.date = "The date can't be in the future";
    else if (tripStart && d.getTime() < new Date(tripStart).getTime() - 7 * DAY) f.date = 'This date is before the trip was scheduled';
    else out.date = d;
  }
  if (b.litres !== undefined) {
    if (isBlank(b.litres) || Number(b.litres) === 0) out.litres = null; // empty means "not recorded"
    else {
      const n = Number(b.litres);
      if (!Number.isFinite(n) || n < 0 || n > 2000) f.litres = 'Litres must be between 0 and 2000';
      else out.litres = round2(n);
    }
  }
  if (b.notes !== undefined) {
    const t = String(b.notes ?? '').trim();
    if (t.length > 300) f.notes = 'Notes can be 300 characters at most';
    else out.notes = t;
  }

  // rules across fields, evaluated on the result of the update
  const category = out.category ?? existing.category;
  const notes = 'notes' in out ? out.notes : existing.notes;
  const litres = 'litres' in out ? out.litres : existing.litres;
  if (category === 'other' && !notes && !f.notes) f.notes = 'Describe what this expense was for';
  if (category && category !== 'diesel') {
    if (b.litres !== undefined && out.litres != null) f.litres = 'Litres apply to diesel only';
    else if (litres != null) out.litres = null; // switching away from diesel drops the litres
  }
  if (Object.keys(f).length) throw invalid(f);
  return out;
}
