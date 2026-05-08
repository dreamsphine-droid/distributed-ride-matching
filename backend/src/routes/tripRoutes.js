// src/routes/tripRoutes.js
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const db = require('../utils/db');

const router = express.Router();

// GET /api/trips — list user's trips
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where = req.user.role === 'DRIVER'
    ? { driverId: req.user.id }
    : { riderId: req.user.id };

  const [trips, total] = await Promise.all([
    db.trip.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit),
      include: {
        rider: { select: { name: true, rating: true } },
        driver: { select: { name: true, rating: true } },
      },
    }),
    db.trip.count({ where }),
  ]);

  res.json({ trips, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
}));

// GET /api/trips/:id
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const trip = await db.trip.findUnique({
    where: { id: req.params.id },
    include: {
      rider: { select: { name: true, phone: true, rating: true } },
      driver: {
        select: {
          name: true, phone: true, rating: true,
          driverProfile: { select: { vehicleModel: true, vehiclePlate: true, vehicleColor: true } },
        },
      },
    },
  });

  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const isRider = trip.riderId === req.user.id;
  const isDriver = trip.driverId === req.user.id;
  const isAdmin = req.user.role === 'ADMIN';
  if (!isRider && !isDriver && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

  res.json(trip);
}));

module.exports = router;
