// src/routes/driverRoutes.js
const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { updateDriverLocation, setDriverStatus, getSystemStats } = require('../services/redisService');
const db = require('../utils/db');

const router = express.Router();

// POST /api/drivers/location — REST fallback for location updates (WebSocket preferred)
router.post('/location', authenticate, authorize('DRIVER'), asyncHandler(async (req, res) => {
  const { lat, lng } = req.body;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

  const driver = await db.driverProfile.findUnique({ where: { userId: req.user.id } });
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

  await updateDriverLocation(req.user.id, lat, lng, {
    name: req.user.name,
    rating: req.user.rating,
    vehicleModel: driver.vehicleModel,
    vehiclePlate: driver.vehiclePlate,
    vehicleColor: driver.vehicleColor,
    acceptanceRate: driver.acceptanceRate,
  });

  await db.driverProfile.update({
    where: { userId: req.user.id },
    data: { currentLat: lat, currentLng: lng, lastPingAt: new Date() },
  });

  res.json({ message: 'Location updated' });
}));

// POST /api/drivers/status
router.post('/status', authenticate, authorize('DRIVER'), asyncHandler(async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['OFFLINE', 'AVAILABLE'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
  }

  await setDriverStatus(req.user.id, status);
  await db.driverProfile.update({
    where: { userId: req.user.id },
    data: { status },
  });

  res.json({ status, message: `Driver status set to ${status}` });
}));

// GET /api/drivers/stats
router.get('/stats', authenticate, authorize('DRIVER'), asyncHandler(async (req, res) => {
  const [profile, recentTrips] = await Promise.all([
    db.driverProfile.findUnique({ where: { userId: req.user.id } }),
    db.trip.findMany({
      where: { driverId: req.user.id, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      take: 10,
    }),
  ]);

  const earnings = recentTrips.reduce((sum, t) => sum + (t.totalFare || 0), 0);
  const systemStats = await getSystemStats();

  res.json({
    profile,
    recentTrips,
    totalEarnings: earnings.toFixed(2),
    systemStats,
  });
}));

module.exports = router;
