import mongoose from 'mongoose';
export default mongoose.model('RateCard', new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' }, // empty = applies to every customer
  vehicleType: { type: String, enum: ['any', 'truck', 'van', 'bus', 'car', 'trailer'], default: 'any' },
  baseFare: { type: Number, default: 0, min: 0 },
  perKm: { type: Number, default: 0, min: 0 },
  perTonne: { type: Number, default: 0, min: 0 },
  minFare: { type: Number, default: 0, min: 0 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true }));
