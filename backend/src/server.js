// src/server.js
require('dotenv').config();
const http = require('http');
const app = require('./app');
const { initializeSocket } = require('./services/socketService');
const { initializeKafka } = require('./services/kafkaService');
const { initializeRedis } = require('./services/redisService');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 3001;

const server = http.createServer(app);

async function startServer() {
  try {
    // Initialize Redis connection
    await initializeRedis();
    logger.info('✅ Redis connected');

    // Initialize Kafka (with graceful fallback)
    try {
      await initializeKafka();
      logger.info('✅ Kafka connected');
    } catch (kafkaErr) {
      logger.warn('⚠️  Kafka unavailable — running in Redis-only mode:', kafkaErr.message);
    }

    // Initialize Socket.io
    initializeSocket(server);
    logger.info('✅ WebSocket server initialized');

    server.listen(PORT, () => {
      logger.info(`🚗 Rideshare backend running on port ${PORT}`);
      logger.info(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

startServer();
