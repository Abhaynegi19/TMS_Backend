import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import User from './models/User.js';
import { can } from './utils/permissions.js';
import { userBranchId } from './utils/scope.js';

let io = null;
const fail = (msg, code) => Object.assign(new Error(msg), { data: { code } });

// Live updates are pushed to rooms: "all" (super admins) and "branch:<id>" (everyone else).
export function initRealtime(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()) },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(fail('Sign in to see live tracking', 'UNAUTHENTICATED'));
      const { id } = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(id);
      if (!user || !user.isActive) return next(fail('This account is not active', 'ACCOUNT_DISABLED'));
      if (!can(user, 'tracking:read')) return next(fail('Your role cannot view live tracking', 'FORBIDDEN'));
      socket.data.user = user;
      next();
    } catch (e) {
      next(fail(e.name === 'TokenExpiredError' ? 'Your session has expired. Please sign in again.' : 'Your session is invalid. Please sign in again.', 'TOKEN_INVALID'));
    }
  });

  io.on('connection', (socket) => {
    const u = socket.data.user;
    if (u.role === 'super_admin') socket.join('all');
    else if (userBranchId(u)) socket.join(`branch:${userBranchId(u)}`);
  });
  return io;
}

const roomsFor = (trip) => ['all', `branch:${trip.branch?._id ?? trip.branch}`, ...(trip.destinationBranch ? [`branch:${trip.destinationBranch._id ?? trip.destinationBranch}`] : [])];

export function emitLocation(trip, payload) { io?.to(roomsFor(trip)).emit('trip:location', payload); }
export function emitTripStatus(trip) { io?.to(roomsFor(trip)).emit('trip:status', { tripId: String(trip._id), status: trip.status }); }
export const closeRealtime = () => new Promise((res) => (io ? io.close(() => res()) : res()));
