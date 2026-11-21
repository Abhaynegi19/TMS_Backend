import mongoose from 'mongoose';
const ref = (to) => ({ type: mongoose.Schema.Types.ObjectId, ref: to });
export default mongoose.model('MaintenanceLog', new mongoose.Schema({
  branch: { ...ref('Branch'), required: true, index: true },
  vehicle: { ...ref('Vehicle'), required: true, index: true },
  type: { type: String, enum: ['service', 'repair', 'tyres', 'inspection', 'other'], default: 'service' },
  date: { type: Date, required: true },
  odometerKm: { type: Number, min: 0 },
  cost: { type: Number, default: 0, min: 0 },
  vendor: { type: String, trim: true },
  notes: { type: String, maxlength: 500 },
  createdBy: ref('User'),
}, { timestamps: true }));
