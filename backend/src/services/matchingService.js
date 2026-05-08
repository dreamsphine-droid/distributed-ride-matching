// src/services/matchingService.js
const {
  findNearbyDrivers,
  acquireDriverLock,
  releaseDriverLock,
  getSurgeMultiplier,
  latLngToGeohash,
} = require('./redisService');
const { publishEvent, TOPICS } = require('./kafkaService');
const { getSocketService } = require('./socketService');
const db = require('../utils/db');
const logger = require('../utils/logger');

// Matching algorithm weights (from case study)
const WEIGHTS = {
  ETA: 0.50,
  RATING: 0.20,
  ACCEPTANCE_RATE: 0.15,
  WAIT_VARIANCE: 0.15,
};

const MATCH_TIMEOUT_MS = 8000; // 8 seconds before re-match
const INITIAL_RADIUS_KM = 5;
const FALLBACK_RADIUS_KM = 10;

/**
 * Score a driver candidate using the weighted scoring function from case study:
 * score(driver) = w1*(1/ETA) + w2*rating + w3*acceptance_rate + w4*(1/wait_variance)
 */
function scoreDriver(driver) {
  const etaScore = WEIGHTS.ETA * (1 / Math.max(driver.distanceKm * 2, 0.5)); // ETA ≈ distance * 2 min/km
  const ratingScore = WEIGHTS.RATING * (driver.rating || 4.5) / 5.0;
  const acceptanceScore = WEIGHTS.ACCEPTANCE_RATE * (driver.acceptanceRate || 0.9);
  const varianceScore = WEIGHTS.WAIT_VARIANCE * (1 / Math.max(driver.distanceKm, 0.1));

  return etaScore + ratingScore + acceptanceScore + varianceScore;
}

/**
 * Calculate distance between two coordinates (Haversine formula)
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Calculate fare based on distance and surge
 */
function calculateFare(distanceKm, surgeMultiplier = 1.0) {
  const BASE_FARE = 2.5;
  const PER_KM = 1.2;
  const base = BASE_FARE + distanceKm * PER_KM;
  return parseFloat((base * surgeMultiplier).toFixed(2));
}

/**
 * Main matching function — called when a ride is requested
 */
async function matchRiderToDriver(rideRequest) {
  const { tripId, riderId, pickupLat, pickupLng, dropoffLat, dropoffLng } = rideRequest;
  const socketService = getSocketService();

  logger.info(`[Matching] Starting match for trip ${tripId}`);

  // ── BUG FIX 1: Verify trip is still in REQUESTED state before matching ──
  // Trip may have been cancelled while matching was queued
  const currentTrip = await db.trip.findUnique({ where: { id: tripId } });
  if (!currentTrip || currentTrip.status !== 'REQUESTED') {
    logger.warn(`[Matching] Trip ${tripId} is no longer REQUESTED (status: ${currentTrip?.status}), aborting`);
    return null;
  }

  // ── BUG FIX 2: Try progressively larger radii including very large fallback ──
  // Drivers in a fresh session may not have sent location yet — give them time
  const radii = [INITIAL_RADIUS_KM, FALLBACK_RADIUS_KM, 25, 50];

  for (const radiusKm of radii) {
    // Re-check trip is still active before each attempt
    const tripCheck = await db.trip.findUnique({ where: { id: tripId } });
    if (!tripCheck || tripCheck.status !== 'REQUESTED') {
      logger.warn(`[Matching] Trip ${tripId} cancelled during search, aborting`);
      return null;
    }

    const candidates = await findNearbyDrivers(pickupLat, pickupLng, radiusKm);
    logger.info(`[Matching] Found ${candidates.length} available drivers within ${radiusKm}km for trip ${tripId}`);

    if (candidates.length === 0) continue;

    // Score and sort candidates
    const scored = candidates
      .map(driver => ({ ...driver, score: scoreDriver(driver) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

    // Try to match with top-scored drivers (skip locked ones)
    for (const driver of scored) {
      // ── BUG FIX 3: Check trip still REQUESTED before each driver attempt ──
      const stillActive = await db.trip.findUnique({ where: { id: tripId } });
      if (!stillActive || stillActive.status !== 'REQUESTED') {
        logger.warn(`[Matching] Trip ${tripId} no longer active, stopping driver loop`);
        return null;
      }

      const lockAcquired = await acquireDriverLock(driver.driverId, tripId);
      if (!lockAcquired) {
        logger.debug(`[Matching] Driver ${driver.driverId} already locked, skipping`);
        continue;
      }

      try {
        // Calculate route details
        const distanceKm = haversineKm(pickupLat, pickupLng, dropoffLat, dropoffLng);
        const durationMin = distanceKm * 2.5;
        const surgeMultiplier = await getSurgeMultiplier(pickupLat, pickupLng);
        const totalFare = calculateFare(distanceKm, surgeMultiplier);
        const etaMin = Math.max(1, Math.ceil(driver.distanceKm * 2));

        // Get driver's full profile from DB for accurate info
        const driverUser = await db.user.findUnique({
          where: { id: driver.driverId },
          include: { driverProfile: true },
        });

        if (!driverUser) {
          await releaseDriverLock(driver.driverId);
          continue;
        }

        // Update trip in database atomically
        const updatedTrip = await db.trip.update({
          where: {
            id: tripId,
            status: 'REQUESTED', // ── BUG FIX 4: Only update if still REQUESTED (race condition guard)
          },
          data: {
            driverId: driver.driverId,
            status: 'MATCHED',
            matchedAt: new Date(),
            distanceKm,
            durationMin,
            surgeMultiplier,
            totalFare,
          },
        }).catch(() => null); // Returns null if trip was already updated by another process

        if (!updatedTrip) {
          // Another process already matched this trip
          await releaseDriverLock(driver.driverId);
          logger.warn(`[Matching] Trip ${tripId} was already matched by another process`);
          return null;
        }

        // Update driver status in DB
        await db.driverProfile.update({
          where: { userId: driver.driverId },
          data: { status: 'MATCHED' },
        });

        // ── BUG FIX 5: Also update Redis driver status so they don't appear in future searches ──
        const { setDriverStatus } = require('./redisService');
        await setDriverStatus(driver.driverId, 'MATCHED');

        const matchResult = {
          tripId,
          riderId,
          driverId: driver.driverId,
          driverName: driverUser.name,
          driverRating: driverUser.rating,
          vehicleModel: driverUser.driverProfile?.vehicleModel || driver.vehicleModel,
          vehiclePlate: driverUser.driverProfile?.vehiclePlate || driver.vehiclePlate,
          vehicleColor: driverUser.driverProfile?.vehicleColor || driver.vehicleColor,
          driverLat: driver.lat,
          driverLng: driver.lng,
          etaMinutes: etaMin,
          distanceKm,
          durationMin,
          surgeMultiplier,
          totalFare,
          status: 'MATCHED',
        };

        // Notify rider via WebSocket
        socketService?.notifyUser(riderId, 'trip:matched', matchResult);

        // Notify driver via WebSocket
        socketService?.notifyUser(driver.driverId, 'trip:assigned', {
          ...matchResult,
          pickupLat,
          pickupLng,
          dropoffLat,
          dropoffLng,
          pickupAddress: rideRequest.pickupAddress,
          dropoffAddress: rideRequest.dropoffAddress,
        });

        // Publish Kafka event
        await publishEvent(TOPICS.MATCH_EVENTS, tripId, {
          type: 'TRIP_MATCHED',
          ...matchResult,
        });

        logger.info(`[Matching] ✅ Trip ${tripId} matched with driver ${driver.driverId} (ETA: ${etaMin}min, fare: $${totalFare})`);
        return matchResult;

      } catch (err) {
        await releaseDriverLock(driver.driverId);
        logger.error(`[Matching] Error matching driver ${driver.driverId}:`, err.message);
        // Don't throw — try next driver instead
        continue;
      }
    }
  }

  // No match found after all radii — check trip still exists before cancelling
  const finalCheck = await db.trip.findUnique({ where: { id: tripId } });
  if (finalCheck && finalCheck.status === 'REQUESTED') {
    logger.warn(`[Matching] ❌ No match found for trip ${tripId} after all attempts`);
    await db.trip.update({
      where: { id: tripId },
      data: { status: 'CANCELLED', cancelReason: 'No drivers available', cancelledAt: new Date() },
    });
    socketService?.notifyUser(riderId, 'trip:no_drivers', { tripId });
  }

  return null;
}

module.exports = {
  matchRiderToDriver,
  scoreDriver,
  calculateFare,
  haversineKm,
};
