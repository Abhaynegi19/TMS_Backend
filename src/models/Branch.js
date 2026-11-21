import mongoose from 'mongoose';
import { duplicateInfo } from '../utils/duplicate.js';
import { STATES, gstinValid } from '../utils/gst.js';
const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  code: { type: String, required: true, unique: true, uppercase: true, trim: true, match: [/^[A-Z0-9]{2,5}$/, 'Code must be 2-5 letters or digits'] },
  city: { type: String, trim: true },
  address: { type: String, trim: true },
  phone: { type: String, trim: true },
  email: { type: String, lowercase: true, trim: true },
  gstin: { type: String, uppercase: true, trim: true, set: (v) => (v === '' || v === null ? undefined : v), validate: { validator: gstinValid, message: 'Enter a valid 15-character GSTIN' } },
  stateCode: { type: String, set: (v) => (v === '' || v === null ? undefined : v), enum: { values: Object.keys(STATES), message: 'Choose a valid state' } },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });
schema.pre('validate', function () {
  if (!this.gstin) return;
  if (!this.stateCode) this.stateCode = this.gstin.slice(0, 2);
  else if (this.gstin.slice(0, 2) !== this.stateCode) this.invalidate('stateCode', 'State does not match the GSTIN');
});
schema.plugin(duplicateInfo);
export default mongoose.model('Branch', schema);
