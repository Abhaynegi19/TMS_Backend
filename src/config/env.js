// Loads server/.env regardless of where the process is started from, and fails fast with clear messages.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
if (!fs.existsSync(envPath)) {
  console.warn(`! No .env file found at ${envPath}\n  Copy .env.example to .env and fill it in.`);
}
dotenv.config({ path: envPath });

const missing = ['MONGO_URI', 'JWT_SECRET'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`x Missing required setting(s): ${missing.join(', ')}\n  Add them to ${envPath}`);
  process.exit(1);
}
if (process.env.JWT_SECRET.length < 16) {
  console.error('x JWT_SECRET is too short. Use at least 16 random characters.');
  process.exit(1);
}
