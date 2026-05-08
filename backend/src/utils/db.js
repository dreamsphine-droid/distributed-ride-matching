// src/utils/db.js
const { PrismaClient } = require('@prisma/client');

const db = global.__prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = db;
}

module.exports = db;
