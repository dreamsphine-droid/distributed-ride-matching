// src/utils/seed.js
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

async function seed() {
  console.log('🌱 Seeding database...');

  const hash = (p) => bcrypt.hash(p, 10);

  // Create admin
  await db.user.upsert({
    where: { email: 'admin@rideshare.com' },
    update: {},
    create: {
      email: 'admin@rideshare.com',
      passwordHash: await hash('admin123'),
      name: 'System Admin',
      role: 'ADMIN',
    },
  });

  // Create sample riders
  const riderData = [
    { email: 'alice@example.com', name: 'Alice Johnson' },
    { email: 'bob@example.com', name: 'Bob Smith' },
    { email: 'carol@example.com', name: 'Carol White' },
  ];

  for (const rider of riderData) {
    await db.user.upsert({
      where: { email: rider.email },
      update: {},
      create: {
        email: rider.email,
        passwordHash: await hash('password123'),
        name: rider.name,
        role: 'RIDER',
        rating: 4.5 + Math.random() * 0.5,
      },
    });
  }

  // Create sample drivers
  const driverData = [
    { email: 'driver1@example.com', name: 'James Wilson', vehicle: 'Toyota Camry', plate: 'NYC-1234', color: 'Silver' },
    { email: 'driver2@example.com', name: 'Maria Garcia', vehicle: 'Honda Civic', plate: 'NYC-5678', color: 'Black' },
    { email: 'driver3@example.com', name: 'David Lee', vehicle: 'Tesla Model 3', plate: 'NYC-9012', color: 'White' },
    { email: 'driver4@example.com', name: 'Sarah Chen', vehicle: 'Ford Explorer', plate: 'NYC-3456', color: 'Blue' },
  ];

  for (const driver of driverData) {
    await db.user.upsert({
      where: { email: driver.email },
      update: {},
      create: {
        email: driver.email,
        passwordHash: await hash('password123'),
        name: driver.name,
        role: 'DRIVER',
        rating: 4.3 + Math.random() * 0.7,
        driverProfile: {
          create: {
            vehicleModel: driver.vehicle,
            vehiclePlate: driver.plate,
            vehicleColor: driver.color,
            totalTrips: Math.floor(Math.random() * 500),
            acceptanceRate: 0.85 + Math.random() * 0.15,
          },
        },
      },
    });
  }

  console.log('✅ Seed complete!');
  console.log('\nTest accounts:');
  console.log('  Rider:   alice@example.com / password123');
  console.log('  Driver:  driver1@example.com / password123');
  console.log('  Admin:   admin@rideshare.com / admin123');

  await db.$disconnect();
}

seed().catch((e) => { console.error(e); process.exit(1); });
