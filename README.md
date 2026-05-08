# 🚗 Distributed Ride-Matching System

A full-stack, production-grade distributed ride-matching platform built following Uber-scale architecture principles.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + Tailwind CSS |
| Backend | Node.js + Express + Socket.io |
| Geo Index | Redis (GEOADD/GEORADIUS) |
| Message Queue | Apache Kafka (via KafkaJS) |
| Primary DB | PostgreSQL |
| ORM | Prisma |
| Containerization | Docker + Docker Compose |
| CI/CD | GitHub Actions |

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/distributed-ride-matching.git
cd distributed-ride-matching

# 2. Copy environment files
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# 3. Start everything with Docker Compose
docker-compose up --build

# App running at:
# Frontend: http://localhost:5173
# Backend API: http://localhost:3001
# Kafka UI: http://localhost:8080
```

## Architecture Overview

```
[Rider/Driver Apps] → [API Gateway (Express)] → [Kafka Topics]
                                                      ↓
                                          [Matching Service]
                                                      ↓
                                    [Redis GeoIndex] → [PostgreSQL]
                                                      ↓
                                       [WebSocket → Client Apps]
```

## Deployment (GitHub + Render/Railway)

See [DEPLOYMENT.md](./DEPLOYMENT.md) for full step-by-step deployment guide.
