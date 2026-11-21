import mongoose from 'mongoose';
export default mongoose.model('AuditLog', new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  userName: String,
  role: String,
  branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', index: true },
  action: String,
  entity: String,
  entityId: mongoose.Schema.Types.ObjectId,
  summary: String,
}, { timestamps: { createdAt: true, updatedAt: false } }));
