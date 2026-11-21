import mongoose from 'mongoose';
// One row per reminder already emailed, so each stage of a deadline is sent only once.
// "mode" separates reminders that were only logged (no SMTP configured) from ones really sent.
const schema = new mongoose.Schema({
  key: { type: String, required: true },
  mode: { type: String, default: 'smtp' },
  branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
  sentAt: { type: Date, default: Date.now },
});
schema.index({ key: 1, mode: 1 }, { unique: true });
export default mongoose.model('AlertLog', schema);
