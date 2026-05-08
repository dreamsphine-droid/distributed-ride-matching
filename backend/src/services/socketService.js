// src/services/socketService.js
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { updateDriverLocation, setDriverStatus } = require('./redisService');
const { publishEvent, TOPICS } = require('./kafkaService');
const logger = require('../utils/logger');

let io = null;
let socketService = null;

// Map userId → Set of socketIds
const userSockets = new Map();

class SocketService {
  constructor(server) {
    io = new Server(server, {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:5173',
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
    });

    io.use(this.authMiddleware.bind(this));
    io.on('connection', this.handleConnection.bind(this));
    logger.info('Socket.io initialized');
  }

  // ─── Auth Middleware ─────────────────────────────────────────
  authMiddleware(socket, next) {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('Authentication token required'));

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
      socket.userId = decoded.userId;
      socket.userRole = decoded.role;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  }

  // ─── Connection Handler ──────────────────────────────────────
  handleConnection(socket) {
    const { userId, userRole } = socket;
    logger.info(`Socket connected: ${userId} (${userRole}) — ${socket.id}`);

    // Register socket → user mapping
    if (!userSockets.has(userId)) userSockets.set(userId, new Set());
    userSockets.get(userId).add(socket.id);

    // Join personal room
    socket.join(`user:${userId}`);
    if (userRole === 'DRIVER') socket.join('drivers');

    // ─── Driver Events ─────────────────────────────────────────
    if (userRole === 'DRIVER') {
      socket.on('driver:location_update', async (data) => {
        try {
          const { lat, lng, speed, heading, rating, name, vehicleModel, vehiclePlate, vehicleColor, acceptanceRate } = data;

          if (!lat || !lng) return;

          await updateDriverLocation(userId, lat, lng, {
            name, rating, vehicleModel, vehiclePlate, vehicleColor, acceptanceRate,
          });

          await publishEvent(TOPICS.DRIVER_LOCATION, userId, {
            type: 'LOCATION_UPDATE',
            driverId: userId,
            lat, lng, speed, heading,
          });

          // Broadcast to admin dashboard
          io.to('admins').emit('driver:moved', { driverId: userId, lat, lng });

        } catch (err) {
          logger.error('Location update error:', err);
        }
      });

      socket.on('driver:go_online', async (data) => {
        try {
          await setDriverStatus(userId, 'AVAILABLE');
          socket.emit('driver:status_changed', { status: 'AVAILABLE' });
          logger.info(`Driver ${userId} went online`);
        } catch (err) {
          logger.error('Go online error:', err);
        }
      });

      socket.on('driver:go_offline', async () => {
        try {
          await setDriverStatus(userId, 'OFFLINE');
          socket.emit('driver:status_changed', { status: 'OFFLINE' });
          logger.info(`Driver ${userId} went offline`);
        } catch (err) {
          logger.error('Go offline error:', err);
        }
      });

      socket.on('driver:accept_trip', async ({ tripId }) => {
        try {
          const db = require('../utils/db');
          await db.trip.update({
            where: { id: tripId },
            data: { status: 'PICKUP' },
          });
          await db.driverProfile.update({
            where: { userId },
            data: { status: 'ON_TRIP' },
          });

          const trip = await db.trip.findUnique({ where: { id: tripId } });
          this.notifyUser(trip.riderId, 'trip:driver_en_route', { tripId });
          socket.emit('trip:accepted', { tripId });

        } catch (err) {
          logger.error('Accept trip error:', err);
        }
      });

      socket.on('driver:start_trip', async ({ tripId }) => {
        try {
          const db = require('../utils/db');
          await db.trip.update({
            where: { id: tripId },
            data: { status: 'IN_PROGRESS', pickedUpAt: new Date() },
          });
          const trip = await db.trip.findUnique({ where: { id: tripId } });
          this.notifyUser(trip.riderId, 'trip:started', { tripId });
          socket.emit('trip:started_ack', { tripId });
        } catch (err) {
          logger.error('Start trip error:', err);
        }
      });

      socket.on('driver:complete_trip', async ({ tripId }) => {
        try {
          const db = require('../utils/db');
          const trip = await db.trip.update({
            where: { id: tripId },
            data: { status: 'COMPLETED', completedAt: new Date() },
          });

          // ── BUG FIX: Reset driver fully in BOTH DB and Redis ──
          // Without this, driver stays MATCHED in Redis and never appears
          // in future findNearbyDrivers searches
          await db.driverProfile.update({
            where: { userId },
            data: { status: 'AVAILABLE', totalTrips: { increment: 1 } },
          });

          // Reset Redis status to AVAILABLE so they show up in future searches
          await setDriverStatus(userId, 'AVAILABLE');

          // ── BUG FIX: Release the driver lock from this trip ──
          const { releaseDriverLock } = require('./redisService');
          await releaseDriverLock(userId);

          this.notifyUser(trip.riderId, 'trip:completed', {
            tripId,
            totalFare: trip.totalFare,
          });

          await publishEvent(TOPICS.TRIP_COMPLETED, tripId, {
            type: 'TRIP_COMPLETED',
            tripId,
            driverId: userId,
            riderId: trip.riderId,
            totalFare: trip.totalFare,
          });

          socket.emit('trip:completed_ack', { tripId, totalFare: trip.totalFare });
          logger.info(`Trip ${tripId} completed by driver ${userId}, driver reset to AVAILABLE`);
        } catch (err) {
          logger.error('Complete trip error:', err);
        }
      });
    }

    // ─── Admin Events ──────────────────────────────────────────
    if (userRole === 'ADMIN') {
      socket.join('admins');
    }

    // ─── Disconnect ────────────────────────────────────────────
    socket.on('disconnect', async () => {
      logger.info(`Socket disconnected: ${userId} — ${socket.id}`);
      userSockets.get(userId)?.delete(socket.id);
      if (userSockets.get(userId)?.size === 0) {
        userSockets.delete(userId);
        if (userRole === 'DRIVER') {
          await setDriverStatus(userId, 'OFFLINE').catch(() => {});
        }
      }
    });
  }

  // ─── Notify a specific user ───────────────────────────────────
  notifyUser(userId, event, data) {
    io.to(`user:${userId}`).emit(event, data);
  }

  // ─── Broadcast to all drivers ─────────────────────────────────
  broadcastToDrivers(event, data) {
    io.to('drivers').emit(event, data);
  }

  getConnectedCount() {
    return io?.engine?.clientsCount || 0;
  }
}

function initializeSocket(server) {
  socketService = new SocketService(server);
  return socketService;
}

function getSocketService() {
  return socketService;
}

module.exports = { initializeSocket, getSocketService };