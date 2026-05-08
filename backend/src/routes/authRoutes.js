// src/routes/authRoutes.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../utils/db');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_EXPIRES = '24h';

function generateToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

// POST /api/auth/register
router.post('/register', asyncHandler(async (req, res) => {
  const { email, password, name, phone, role = 'RIDER', vehicleModel, vehiclePlate, vehicleColor } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: 'email, password, and name are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await db.user.create({
    data: {
      email,
      passwordHash,
      name,
      phone,
      role,
      ...(role === 'DRIVER' && {
        driverProfile: {
          create: {
            vehicleModel: vehicleModel || 'Toyota Camry',
            vehiclePlate: vehiclePlate || 'XX-0000',
            vehicleColor: vehicleColor || 'White',
          },
        },
      }),
    },
    include: { driverProfile: true },
  });

  const token = generateToken(user);

  res.status(201).json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      rating: user.rating,
      driverProfile: user.driverProfile,
    },
  });
}));

// POST /api/auth/login
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }

  const user = await db.user.findUnique({
    where: { email },
    include: { driverProfile: true },
  });

  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = generateToken(user);

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      rating: user.rating,
      phone: user.phone,
      driverProfile: user.driverProfile,
    },
  });
}));

// GET /api/auth/me
router.get('/me', asyncHandler(async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });

  const decoded = jwt.verify(token, JWT_SECRET);
  const user = await db.user.findUnique({
    where: { id: decoded.userId },
    include: { driverProfile: true },
  });

  if (!user) return res.status(404).json({ error: 'User not found' });

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    rating: user.rating,
    phone: user.phone,
    driverProfile: user.driverProfile,
  });
}));

module.exports = router;
