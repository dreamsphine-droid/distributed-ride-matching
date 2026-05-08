// src/services/redisService.js
const Redis = require('ioredis');
const logger = require('../utils/logger');

let redis = null;

async function initializeRedis() {
  redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    retryStrategy: (times) => Math.min(times * 50, 2000),
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });

  await new Promise((resolve, reject) => {
    redis.on('ready', resolve);
    redis.on('error', reject);
    setTimeout(reject, 5000);
  });

  return redis;
}

function getRedis() {
  return redis;
}

// ─── Geospatial Operations ────────────────────────────────────

const GEO_KEY = 'drivers:geo';
const DRIVER_STATUS_PREFIX = 'driver:status:';
const DRIVER_DATA_PREFIX = 'driver:data:';

/**
 * Update driver location in Redis geo index
 */
async function updateDriverLocation(driverId, lat, lng, metadata = {}) {
  const pipeline = redis.pipeline();

  // GEOADD for spatial indexing
  pipeline.geoadd(GEO_KEY, lng, lat, driverId);

  // Store driver metadata
  pipeline.setex(
    `${DRIVER_DATA_PREFIX}${driverId}`,
    30, // TTL: 30 seconds (driver must ping every 4s)
    JSON.stringify({
      driverId,
      lat,
      lng,
      ...metadata,
      updatedAt: Date.now(),
    })
  );

  await pipeline.exec();
}

/**
 * Find available drivers within radius using GEORADIUS
 * Returns: array of { driverId, distanceKm, lat, lng, ...metadata }
 */
async function findNearbyDrivers(lat, lng, radiusKm = 5) {
  // GEORADIUS: find all members within radius
  const results = await redis.georadius(
    GEO_KEY,
    lng,
    lat,
    radiusKm,
    'km',
    'ASC',       // sort by distance
    'WITHCOORD', // include coordinates
    'WITHDIST',  // include distance
    'COUNT', 20  // max 20 candidates
  );

  if (!results || results.length === 0) return [];

  // Fetch driver metadata in parallel
  const pipeline = redis.pipeline();
  results.forEach(([driverId]) => {
    pipeline.get(`${DRIVER_DATA_PREFIX}${driverId}`);
    pipeline.get(`${DRIVER_STATUS_PREFIX}${driverId}`);
  });
  const metaResults = await pipeline.exec();

  const drivers = [];
  results.forEach(([driverId, distanceKm, [driverLng, driverLat]], index) => {
    const metaRaw = metaResults[index * 2]?.[1];
    const status = metaResults[index * 2 + 1]?.[1];

    // Only include AVAILABLE drivers with fresh location data
    if (status !== 'AVAILABLE' || !metaRaw) return;

    try {
      const meta = JSON.parse(metaRaw);
      drivers.push({
        driverId,
        distanceKm: parseFloat(distanceKm),
        lat: parseFloat(driverLat),
        lng: parseFloat(driverLng),
        ...meta,
      });
    } catch (e) {
      // Skip malformed data
    }
  });

  return drivers;
}

/**
 * Set driver availability status
 */
async function setDriverStatus(driverId, status) {
  if (status === 'OFFLINE') {
    // Remove from geo index when offline
    const pipeline = redis.pipeline();
    pipeline.zrem(GEO_KEY, driverId);
    pipeline.del(`${DRIVER_STATUS_PREFIX}${driverId}`);
    await pipeline.exec();
  } else {
    await redis.setex(`${DRIVER_STATUS_PREFIX}${driverId}`, 60, status);
  }
}

/**
 * Try to atomically lock a driver for matching (SETNX pattern)
 * Returns true if lock acquired, false if driver already being matched
 */
async function acquireDriverLock(driverId, tripId, ttlSeconds = 15) {
  const lockKey = `lock:driver:${driverId}`;
  const result = await redis.set(lockKey, tripId, 'NX', 'EX', ttlSeconds);
  return result === 'OK';
}

/**
 * Release driver lock
 */
async function releaseDriverLock(driverId) {
  await redis.del(`lock:driver:${driverId}`);
}

// ─── Surge Pricing ────────────────────────────────────────────

/**
 * Encode lat/lng to geohash prefix (simplified)
 */
function latLngToGeohash(lat, lng, precision = 6) {
  // Simplified geohash — in production use a proper library
  const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
  let minLat = -90, maxLat = 90;
  let minLng = -180, maxLng = 180;
  let hash = '';
  let isEven = true;

  while (hash.length < precision) {
    let mid, bits = 0;
    for (let i = 4; i >= 0; i--) {
      if (isEven) {
        mid = (minLng + maxLng) / 2;
        if (lng > mid) { bits |= (1 << i); minLng = mid; }
        else maxLng = mid;
      } else {
        mid = (minLat + maxLat) / 2;
        if (lat > mid) { bits |= (1 << i); minLat = mid; }
        else maxLat = mid;
      }
      isEven = !isEven;
    }
    hash += BASE32[bits];
  }
  return hash;
}

async function getSurgeMultiplier(lat, lng) {
  const geohash = latLngToGeohash(lat, lng, 6);
  const key = `surge:${geohash}`;
  const surge = await redis.get(key);
  return surge ? parseFloat(surge) : 1.0;
}

async function updateSurgeZone(geohash, demandCount, supplyCount) {
  const ratio = supplyCount > 0 ? demandCount / supplyCount : 3.0;
  let multiplier = 1.0;
  if (ratio > 2.0) multiplier = 2.5;
  else if (ratio > 1.5) multiplier = 1.8;
  else if (ratio > 1.2) multiplier = 1.3;

  await redis.setex(`surge:${geohash}`, 30, multiplier.toFixed(2));
  return multiplier;
}

// ─── Session & Misc ───────────────────────────────────────────

async function setSession(key, value, ttlSeconds = 3600) {
  await redis.setex(key, ttlSeconds, JSON.stringify(value));
}

async function getSession(key) {
  const val = await redis.get(key);
  return val ? JSON.parse(val) : null;
}

async function deleteSession(key) {
  await redis.del(key);
}

// ─── Stats ────────────────────────────────────────────────────

async function getSystemStats() {
  const [driverCount, info] = await Promise.all([
    redis.zcard(GEO_KEY),
    redis.info('memory'),
  ]);

  return {
    activeDrivers: driverCount,
    redisMemory: info.match(/used_memory_human:(\S+)/)?.[1] || 'unknown',
  };
}

module.exports = {
  initializeRedis,
  getRedis,
  updateDriverLocation,
  findNearbyDrivers,
  setDriverStatus,
  acquireDriverLock,
  releaseDriverLock,
  getSurgeMultiplier,
  updateSurgeZone,
  latLngToGeohash,
  setSession,
  getSession,
  deleteSession,
  getSystemStats,
};
