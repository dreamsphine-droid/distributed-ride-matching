// src/routes/rideRoutes.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { matchRiderToDriver } = require('../services/matchingService');
const { publishEvent, TOPICS } = require('../services/kafkaService');
const { getSurgeMultiplier, latLngToGeohash } = require('../services/redisService');
const db = require('../utils/db');
const logger = require('../utils/logger');

const router = express.Router();

// POST /api/rides/request — rider requests a ride
router.post('/request', authenticate, authorize('RIDER'), asyncHandler(async (req, res) => {
  const {
    pickupLat, pickupLng, pickupAddress,
    dropoffLat, dropoffLng, dropoffAddress,
  } = req.body;

  if (!pickupLat || !pickupLng || !dropoffLat || !dropoffLng) {
    return res.status(400).json({ error: 'Pickup and dropoff coordinates required' });
  }

  // Check for existing active trip
  const activeTrip = await db.trip.findFirst({
    where: {
      riderId: req.user.userId,
      status: { in: ['REQUESTED', 'MATCHED', 'PICKUP', 'IN_PROGRESS'] },
    },
  });

  if (activeTrip) {
    return res.status(409).json({
      error: 'You already have an active trip',
      tripId: activeTrip.id,
    });
  }

  // Get current surge multiplier for pickup location
  const surgeMultiplier = await getSurgeMultiplier(pickupLat, pickupLng);

  // Create trip record
  const trip = await db.trip.create({
    data: {
      riderId: req.user.userId,
      status: 'REQUESTED',
      pickupLat: parseFloat(pickupLat),
      pickupLng: parseFloat(pickupLng),
      pickupAddress: pickupAddress || `${pickupLat}, ${pickupLng}`,
      dropoffLat: parseFloat(dropoffLat),
      dropoffLng: parseFloat(dropoffLng),
      dropoffAddress: dropoffAddress || `${dropoffLat}, ${dropoffLng}`,
      surgeMultiplier,
    },
  });

  logger.info(`Ride requested: trip ${trip.id} by rider ${req.user.userId}`);

  // Publish to Kafka (async — doesn't block response)
  await publishEvent(TOPICS.RIDE_REQUESTED, trip.id, {
    type: 'RIDE_REQUESTED',
    tripId: trip.id,
    riderId: req.user.userId,
    pickupLat, pickupLng, pickupAddress,
    dropoffLat, dropoffLng, dropoffAddress,
    surgeMultiplier,
  });

  // Respond immediately, matching happens async
  res.status(202).json({
    message: 'Ride request accepted — matching in progress',
    tripId: trip.id,
    surgeMultiplier,
    estimatedWait: '2-5 minutes',
  });

  // Run matching asynchronously (don't await — client gets notified via WebSocket)
  setImmediate(async () => {
    try {
      await matchRiderToDriver({
        tripId: trip.id,
        riderId: req.user.userId,
        pickupLat: parseFloat(pickupLat),
        pickupLng: parseFloat(pickupLng),
        dropoffLat: parseFloat(dropoffLat),
        dropoffLng: parseFloat(dropoffLng),
        pickupAddress: pickupAddress || `${pickupLat}, ${pickupLng}`,
        dropoffAddress: dropoffAddress || `${dropoffLat}, ${dropoffLng}`,
      });
    } catch (err) {
      logger.error(`Matching failed for trip ${trip.id}:`, err);
    }
  });
}));

// GET /api/rides/estimate — fare estimate before booking
router.get('/estimate', authenticate, asyncHandler(async (req, res) => {
  const { pickupLat, pickupLng, dropoffLat, dropoffLng } = req.query;

  if (!pickupLat || !pickupLng || !dropoffLat || !dropoffLng) {
    return res.status(400).json({ error: 'All coordinates required' });
  }

  const { calculateFare, haversineKm } = require('../services/matchingService');
  const surge = await getSurgeMultiplier(parseFloat(pickupLat), parseFloat(pickupLng));
  const distance = haversineKm(
    parseFloat(pickupLat), parseFloat(pickupLng),
    parseFloat(dropoffLat), parseFloat(dropoffLng)
  );
  const fare = calculateFare(distance, surge);

  res.json({
    distanceKm: distance.toFixed(2),
    estimatedDurationMin: Math.ceil(distance * 2.5),
    surgeMultiplier: surge,
    estimatedFare: fare,
    currency: 'USD',
  });
}));

// GET /api/rides/nearby-drivers — check driver availability around location
router.get('/nearby-drivers', authenticate, asyncHandler(async (req, res) => {
  const { lat, lng, radius = 5 } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

  const { findNearbyDrivers } = require('../services/redisService');
  const drivers = await findNearbyDrivers(parseFloat(lat), parseFloat(lng), parseFloat(radius));

  res.json({
    count: drivers.length,
    drivers: drivers.map(d => ({
      driverId: d.driverId,
      lat: d.lat,
      lng: d.lng,
      distanceKm: d.distanceKm,
      rating: d.rating,
      vehicleModel: d.vehicleModel,
    })),
  });
}));

// POST /api/rides/:tripId/cancel
router.post('/:tripId/cancel', authenticate, asyncHandler(async (req, res) => {
  const { tripId } = req.params;
  const { reason } = req.body;

  const trip = await db.trip.findUnique({ where: { id: tripId } });
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  if (trip.riderId !== req.user.userId && req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Not authorized to cancel this trip' });
  }

  const cancellableStatuses = ['REQUESTED', 'MATCHED', 'PICKUP'];
  if (!cancellableStatuses.includes(trip.status)) {
    return res.status(400).json({ error: `Cannot cancel trip with status: ${trip.status}` });
  }

  await db.trip.update({
    where: { id: tripId },
    data: {
      status: 'CANCELLED',
      cancelReason: reason || 'Cancelled by rider',
      cancelledAt: new Date(),
    },
  });

  // Free the driver if matched
  if (trip.driverId) {
    const { releaseDriverLock, setDriverStatus } = require('../services/redisService');
    await releaseDriverLock(trip.driverId);
    await setDriverStatus(trip.driverId, 'AVAILABLE');
    await db.driverProfile.update({
      where: { userId: trip.driverId },
      data: { status: 'AVAILABLE' },
    });

    const { getSocketService } = require('../services/socketService');
    getSocketService()?.notifyUser(trip.driverId, 'trip:cancelled', { tripId, reason });
  }

  res.json({ message: 'Trip cancelled', tripId });
}));

module.exports = router;
