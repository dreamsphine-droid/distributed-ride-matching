// src/routes/adminRoutes.js
const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { getSystemStats, getRedis } = require('../services/redisService');
const { isKafkaAvailable } = require('../services/kafkaService');
const { getSocketService } = require('../services/socketService');
const db = require('../utils/db');

const router = express.Router();

// All admin routes require ADMIN role
router.use(authenticate, authorize('ADMIN'));

// GET /api/admin/dashboard
router.get('/dashboard', asyncHandler(async (req, res) => {
  const [
    totalUsers,
    totalDrivers,
    activeTrips,
    completedToday,
    totalRevenue,
    redisStats,
  ] = await Promise.all([
    db.user.count({ where: { role: 'RIDER' } }),
    db.user.count({ where: { role: 'DRIVER' } }),
    db.trip.count({ where: { status: { in: ['REQUESTED', 'MATCHED', 'PICKUP', 'IN_PROGRESS'] } } }),
    db.trip.count({
      where: {
        status: 'COMPLETED',
        completedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    }),
    db.trip.aggregate({
      where: { status: 'COMPLETED' },
      _sum: { totalFare: true },
    }),
    getSystemStats(),
  ]);

  const socketService = getSocketService();

  res.json({
    metrics: {
      totalRiders: totalUsers,
      totalDrivers,
      activeTrips,
      completedToday,
      totalRevenue: totalRevenue._sum.totalFare?.toFixed(2) || '0.00',
      activeConnections: socketService?.getConnectedCount() || 0,
      ...redisStats,
    },
    services: {
      kafka: isKafkaAvailable() ? 'connected' : 'unavailable (fallback mode)',
      redis: 'connected',
      postgres: 'connected',
    },
  });
}));

// GET /api/admin/trips
router.get('/trips', asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where = status ? { status } : {};
  const [trips, total] = await Promise.all([
    db.trip.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit),
      include: {
        rider: { select: { name: true, email: true } },
        driver: { select: { name: true, email: true } },
      },
    }),
    db.trip.count({ where }),
  ]);

  res.json({ trips, total, page: parseInt(page) });
}));

// GET /api/admin/users
router.get('/users', asyncHandler(async (req, res) => {
  const { role, page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const where = role ? { role } : {};

  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      select: {
        id: true, name: true, email: true, role: true, rating: true,
        createdAt: true, driverProfile: true,
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit),
    }),
    db.user.count({ where }),
  ]);

  res.json({ users, total });
}));

module.exports = router;
