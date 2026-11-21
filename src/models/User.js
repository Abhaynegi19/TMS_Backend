import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { ROLES } from '../utils/permissions.js';
import { duplicateInfo } from '../utils/duplicate.js';

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, select: false },
  role: { type: String, enum: ROLES, required: true },
  branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
  driverProfile: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver' },
  isActive: { type: Boolean, default: true },
  lastLoginAt: Date,
}, { timestamps: true });

schema.pre('save', async function () {
  if (this.isModified('password')) this.password = await bcrypt.hash(this.password, 10);
});
schema.methods.matches = function (pw) { return bcrypt.compare(pw, this.password); };

schema.plugin(duplicateInfo);
export default mongoose.model('User', schema);
