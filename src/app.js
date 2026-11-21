import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { protect } from './middleware/auth.js';
import { AppError } from './utils/errors.js';
import { errorHandler } from './utils/errorHandler.js';
import authRoutes from './routes/auth.js';
import branchRoutes from './routes/branches.js';
import userRoutes from './routes/users.js';
import tripRoutes from './routes/trips.js';
import dashboardRoutes from './routes/dashboard.js';
import auditRoutes from './routes/audit.js';
import trackingRoutes from './routes/tracking.js';
import alertRoutes from './routes/alerts.js';
import expenseRoutes from './routes/expenses.js';
import reportRoutes from './routes/reports.js';
import publicRoutes from './routes/public.js';
import { customers, rates, maintenance } from './routes/business.js';
import { vehicles, drivers } from './routes/resources.js';

const app = express();
app.set('trust proxy', 1);
app.use((req, res, next) => { req.id = crypto.randomUUID(); res.setHeader('X-Request-Id', req.id); next(); });
app.use(helmet());
app.use(cors({
  origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Branch'],
  exposedHeaders: ['Content-Disposition', 'X-Request-Id', 'X-Report-Rows', 'X-Report-Truncated'],
}));
// Delivery photos arrive as base64 in JSON, so that one endpoint gets a larger body limit.
const small = express.json({ limit: '100kb' });
const large = express.json({ limit: '8mb' });
app.use((req, res, next) => (req.method === 'POST' && /^\/api\/trips\/[^/]+\/pod$/.test(req.path) ? large : small)(req, res, next));
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));
app.use('/api', rateLimit({
  windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === 'test',
  handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Please slow down and try again shortly.')),
}));

app.get('/api/health', (_req, res) => res.json({ data: { status: 'ok' } }));
app.use('/api/auth', authRoutes);
app.use('/api/branches', protect, branchRoutes);
app.use('/api/users', protect, userRoutes);
app.use('/api/vehicles', protect, vehicles);
app.use('/api/drivers', protect, drivers);
app.use('/api/trips', protect, tripRoutes);
app.use('/api/dashboard', protect, dashboardRoutes);
app.use('/api/audit', protect, auditRoutes);
app.use('/api/tracking', protect, trackingRoutes);
app.use('/api/customers', protect, customers);
app.use('/api/rates', protect, rates);
app.use('/api/maintenance', protect, maintenance);
app.use('/api/alerts', protect, alertRoutes);
app.use('/api/expenses', protect, expenseRoutes);
app.use('/api/reports', protect, reportRoutes);
app.use('/api/public', publicRoutes);

app.use('/api', (req, _res, next) => next(new AppError(404, 'NOT_FOUND', `No such endpoint: ${req.method} ${req.originalUrl}`)));
app.use(errorHandler);

export default app;
