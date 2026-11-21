import mongoose from 'mongoose';
const ref = (to) => ({ type: mongoose.Schema.Types.ObjectId, ref: to });
const schema = new mongoose.Schema({
  trip: { ...ref('Trip'), required: true },
  driver: ref('Driver'),
  branch: ref('Branch'),
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  speed: Number, // km/h
  heading: Number, // degrees
  accuracy: Number, // metres
  at: { type: Date, default: Date.now },
});
schema.index({ trip: 1, at: 1 });
schema.index({ at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 }); // keep breadcrumbs for 30 days
export default mongoose.model('LocationPing', schema);
