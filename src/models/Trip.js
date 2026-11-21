import mongoose from 'mongoose';
import { duplicateInfo } from '../utils/duplicate.js';
const podSchema = new mongoose.Schema({
  receiverName: { type: String, required: true, trim: true, maxlength: 80 },
  notes: { type: String, maxlength: 500 },
  photos: [String],
  signature: String,
  lat: Number,
  lng: Number,
  deliveredAt: { type: Date, default: Date.now },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { _id: false });
const ref = (to) => ({ type: mongoose.Schema.Types.ObjectId, ref: to });
const schema = new mongoose.Schema({
  tripNo: { type: String, required: true, unique: true },
  branch: { ...ref('Branch'), required: true, index: true },
  destinationBranch: ref('Branch'),
  customer: { type: String, required: true, trim: true },
  customerRef: ref('Customer'),
  origin: { type: String, required: true, trim: true },
  destination: { type: String, required: true, trim: true },
  cargo: { type: String, trim: true },
  cargoWeightKg: { type: Number, default: 0, min: 0 },
  scheduledAt: { type: Date, required: true },
  vehicle: ref('Vehicle'),
  driver: ref('Driver'),
  status: { type: String, enum: ['planned', 'in-transit', 'completed', 'cancelled'], default: 'planned' },
  paymentStatus: { type: String, enum: ['unpaid', 'partial', 'paid'], default: 'unpaid' },
  distanceKm: { type: Number, default: 0, min: 0 },
  fare: { type: Number, default: 0, min: 0 },
  lastLocation: { lat: Number, lng: Number, speed: Number, heading: Number, accuracy: Number, at: Date },
  pod: podSchema,
  invoice: mongoose.Schema.Types.Mixed, // frozen copy of the figures on the issued invoice
  trackHash: { type: String, index: true, sparse: true },
  trackExpiresAt: Date,
  invoiceNo: { type: String, unique: true, sparse: true },
  invoicedAt: Date,
  startedAt: Date,
  completedAt: Date,
  notes: { type: String, maxlength: 500 },
  createdBy: ref('User'),
}, { timestamps: true });
schema.plugin(duplicateInfo);
export default mongoose.model('Trip', schema);
