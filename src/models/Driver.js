import mongoose from 'mongoose';
import { duplicateInfo } from '../utils/duplicate.js';
const schema = new mongoose.Schema({
  branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  phone: { type: String, required: true, trim: true },
  licenseNo: { type: String, required: true, unique: true, uppercase: true, trim: true },
  licenseExpiry: Date,
  status: { type: String, enum: ['available', 'on-trip', 'off-duty'], default: 'available' },
}, { timestamps: true });
schema.plugin(duplicateInfo);
export default mongoose.model('Driver', schema);
