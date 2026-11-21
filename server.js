import './src/config/env.js';
import mongoose from 'mongoose';
import http from 'node:http';
import app from './src/app.js';
import { initRealtime, closeRealtime } from './src/realtime.js';
import { startAlertScheduler } from './src/services/alerts.js';

const port = process.env.PORT || 5000;

process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e));

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
} catch (e) {
  console.error(`x Could not connect to MongoDB: ${e.message}`);
  if (/ECONNREFUSED/.test(e.message)) console.error('  Is MongoDB running? Start it locally, or use a MongoDB Atlas connection string in MONGO_URI.');
  if (/auth/i.test(e.message)) console.error('  Check the username/password in MONGO_URI.');
  process.exit(1);
}
const server = http.createServer(app);
initRealtime(server);
server.listen(port, () => console.log(`API ready on http://localhost:${port} (live tracking on)`));
startAlertScheduler();
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `x Port ${port} is already in use. Change PORT in .env.` : `x Server error: ${e.message}`);
  process.exit(1);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => closeRealtime().then(() => mongoose.disconnect()).then(() => process.exit(0)));
