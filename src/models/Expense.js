import mongoose from 'mongoose';
import { CATEGORIES, MAX_AMOUNT } from '../utils/expense.js';

const ref = (to) => ({ type: mongoose.Schema.Types.ObjectId, ref: to });
export default mongoose.model('Expense', new mongoose.Schema({
  branch: { ...ref('Branch'), required: true, index: true },
  trip: { ...ref('Trip'), required: true, index: true },
  driver: ref('Driver'), // copied from the trip, so drivers see only their own expenses
  vehicle: ref('Vehicle'),
  category: { type: String, enum: CATEGORIES, required: true },
  amount: { type: Number, required: true, min: [0.01, 'Amount must be greater than zero'], max: MAX_AMOUNT },
  litres: { type: Number, min: 0 },
  date: { type: Date, required: true, default: Date.now },
  notes: { type: String, maxlength: 300 },
  createdBy: ref('User'),
  editedBy: ref('User'),
  editedAt: Date,
}, { timestamps: true }));
