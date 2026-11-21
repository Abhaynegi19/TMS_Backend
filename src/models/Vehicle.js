import mongoose from 'mongoose';
import { duplicateInfo } from '../utils/duplicate.js';
const schema = new mongoose.Schema({
  branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
  plate: { type: String, required: true, unique: true, uppercase: true, trim: true },
  type: { type: String, enum: ['truck', 'van', 'bus', 'car', 'trailer'], default: 'truck' },
  capacityKg: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['available', 'on-trip', 'maintenance'], default: 'available' },
  lastService: Date,
  lastServiceKm: { type: Number, default: 0, min: 0 },
  serviceIntervalKm: { type: Number, default: 0, min: 0 }, // 0 = no distance-based reminder
  serviceIntervalDays: { type: Number, default: 0, min: 0 }, // 0 = no date-based reminder
  odometerKm: { type: Number, default: 0, min: 0 },
  insuranceExpiry: Date,
  permitExpiry: Date,
  fitnessExpiry: Date,
  pucExpiry: Date,
  notes: { type: String, maxlength: 500 },
}, { timestamps: true });
schema.plugin(duplicateInfo);
export default mongoose.model('Vehicle', schema);
