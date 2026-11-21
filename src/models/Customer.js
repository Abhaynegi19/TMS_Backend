import mongoose from 'mongoose';
import { duplicateInfo } from '../utils/duplicate.js';
import { STATES, gstinValid } from '../utils/gst.js';

const blank = (v) => (v === '' || v === null ? undefined : v);
const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120, index: true },
  contactName: { type: String, trim: true },
  phone: { type: String, trim: true },
  email: { type: String, lowercase: true, trim: true, set: blank, match: [/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Enter a valid email address'] },
  address: { type: String, trim: true },
  city: { type: String, trim: true },
  stateCode: { type: String, set: blank, enum: { values: Object.keys(STATES), message: 'Choose a valid state' } },
  gstin: { type: String, uppercase: true, trim: true, set: blank, unique: true, sparse: true, validate: { validator: gstinValid, message: 'Enter a valid 15-character GSTIN' } },
  paymentTermsDays: { type: Number, default: 30, min: 0, max: 365 },
  isActive: { type: Boolean, default: true },
  notes: { type: String, maxlength: 500 },
}, { timestamps: true });

schema.pre('validate', function () {
  if (!this.gstin) return;
  if (!this.stateCode) this.stateCode = this.gstin.slice(0, 2);
  else if (this.gstin.slice(0, 2) !== this.stateCode) this.invalidate('stateCode', 'State does not match the GSTIN');
});
schema.plugin(duplicateInfo);
export default mongoose.model('Customer', schema);
