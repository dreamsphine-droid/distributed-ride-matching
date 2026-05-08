// src/services/kafkaService.js
const { Kafka, Partitioners } = require('kafkajs');
const logger = require('../utils/logger');

let kafka = null;
let producer = null;
let consumers = {};
let kafkaAvailable = false;

const TOPICS = {
  RIDE_REQUESTED: 'ride.requested',
  DRIVER_LOCATION: 'driver.location',
  MATCH_EVENTS: 'match.events',
  TRIP_COMPLETED: 'trip.completed',
  PRICING_UPDATED: 'pricing.updated',
};

async function initializeKafka() {
  kafka = new Kafka({
    clientId: 'rideshare-backend',
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    retry: {
      initialRetryTime: 100,
      retries: 3,
    },
    connectionTimeout: 3000,
  });

  producer = kafka.producer({
    createPartitioner: Partitioners.LegacyPartitioner,
    allowAutoTopicCreation: true,
  });

  await producer.connect();
  kafkaAvailable = true;

  // Create topics
  const admin = kafka.admin();
  await admin.connect();
  await admin.createTopics({
    topics: [
      { topic: TOPICS.RIDE_REQUESTED, numPartitions: 4 },
      { topic: TOPICS.DRIVER_LOCATION, numPartitions: 8 },
      { topic: TOPICS.MATCH_EVENTS, numPartitions: 4 },
      { topic: TOPICS.TRIP_COMPLETED, numPartitions: 4 },
      { topic: TOPICS.PRICING_UPDATED, numPartitions: 2 },
    ],
    waitForLeaders: true,
  });
  await admin.disconnect();

  logger.info('Kafka topics created/verified');
}

/**
 * Publish an event to a Kafka topic
 * Falls back to no-op if Kafka unavailable
 */
async function publishEvent(topic, key, value) {
  if (!kafkaAvailable || !producer) {
    logger.debug(`[Kafka SKIP] ${topic} — ${JSON.stringify(value)}`);
    return;
  }

  try {
    await producer.send({
      topic,
      messages: [{
        key: key?.toString(),
        value: JSON.stringify({
          ...value,
          eventId: require('uuid').v4(),
          timestamp: new Date().toISOString(),
        }),
      }],
    });
  } catch (err) {
    logger.error(`Kafka publish error (${topic}):`, err.message);
  }
}

/**
 * Subscribe to a Kafka topic with a consumer group
 */
async function subscribeToTopic(topic, groupId, handler) {
  if (!kafkaAvailable) return;

  const consumer = kafka.consumer({ groupId });
  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const value = JSON.parse(message.value.toString());
        await handler(value, message.key?.toString());
      } catch (err) {
        logger.error(`Kafka consumer error (${topic}):`, err);
      }
    },
  });

  consumers[groupId] = consumer;
  logger.info(`Kafka consumer started: ${groupId} → ${topic}`);
}

async function disconnectKafka() {
  if (producer) await producer.disconnect();
  for (const consumer of Object.values(consumers)) {
    await consumer.disconnect();
  }
}

module.exports = {
  initializeKafka,
  publishEvent,
  subscribeToTopic,
  disconnectKafka,
  TOPICS,
  isKafkaAvailable: () => kafkaAvailable,
};
