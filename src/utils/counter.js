import Counter from '../models/Counter.js';
import { fiscalYear } from './gst.js';
export async function nextTripNo(branch) {
  const c = await Counter.findOneAndUpdate({ _id: `trip:${branch.code}` }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return `TRP-${branch.code}-${String(c.seq).padStart(5, '0')}`;
}

// e.g. DEL/2627/00001: unique, sequential per branch per financial year, 16 characters at most (GST rule 46).
export async function nextInvoiceNo(branch, date = new Date()) {
  const fy = fiscalYear(date);
  const c = await Counter.findOneAndUpdate({ _id: `inv:${branch.code}:${fy}` }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return `${branch.code}/${fy}/${String(c.seq).padStart(5, '0')}`;
}
