// Base URL of the web app, used in emailed links.
export const publicUrl = () => (process.env.PUBLIC_URL || (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',')[0]).trim().replace(/\/$/, '');
import crypto from 'node:crypto';
// Tracking tokens are stored only as a hash, so a database leak does not expose live links.
export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
