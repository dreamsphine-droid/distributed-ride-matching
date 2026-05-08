# DEPLOYMENT.md — Step-by-Step GitHub Deployment Guide

This guide walks you through deploying the Distributed Ride-Matching System from zero to live.
We'll use **GitHub** for code + CI/CD, **Render** for the backend, and **Vercel** for the frontend.
All free tiers.

---

## PART 1 — Local Setup & First Run

### Step 1: Install prerequisites
Make sure you have these installed:
```bash
node --version    # Need v18+
docker --version  # Need Docker Desktop
git --version
```

### Step 2: Clone / initialise the project
```bash
# If you downloaded the zip, just cd into it:
cd distributed-ride-matching

# OR init a fresh git repo:
git init
git add .
git commit -m "feat: initial commit — distributed ride matching system"
```

### Step 3: Set up environment files
```bash
# Backend
cp backend/.env.example backend/.env

# Frontend
cp frontend/.env.example frontend/.env
```

Open `backend/.env` and change `JWT_SECRET` to a random string (use a password manager or run `openssl rand -hex 32`).

### Step 4: Start everything with Docker Compose
```bash
docker-compose up --build
```

This starts: PostgreSQL, Redis, Zookeeper, Kafka, Kafka UI, Backend, Frontend.
First run takes ~3-5 minutes to download images.

### Step 5: Seed the database
```bash
# In a new terminal, while docker-compose is running:
docker exec rideshare-backend npm run db:seed
```

You'll see the test accounts printed:
```
Rider:   alice@example.com / password123
Driver:  driver1@example.com / password123
Admin:   admin@rideshare.com / admin123
```

### Step 6: Verify everything works
- Frontend:  http://localhost:5173
- Backend:   http://localhost:3001/health
- Kafka UI:  http://localhost:8080

---

## PART 2 — Push to GitHub

### Step 7: Create a GitHub repository
1. Go to https://github.com/new
2. Repository name: `distributed-ride-matching`
3. Set to **Public** or Private
4. Do NOT initialize with README (you already have one)
5. Click **Create repository**

### Step 8: Push your code
```bash
git remote add origin https://github.com/YOUR_USERNAME/distributed-ride-matching.git
git branch -M main
git push -u origin main
```

### Step 9: Verify CI runs
Go to your repo → **Actions** tab. You should see the CI pipeline running automatically.
It will:
- Start a test PostgreSQL + Redis
- Run Prisma migrations
- Verify the backend loads
- Build the frontend

If it goes green ✅, your code is clean.

---

## PART 3 — Deploy Backend to Render

Render gives you a free Node.js server with PostgreSQL and Redis.

### Step 10: Create a Render account
Sign up at https://render.com using your GitHub account.

### Step 11: Create a PostgreSQL database
1. Render Dashboard → **New** → **PostgreSQL**
2. Name: `rideshare-db`
3. Plan: **Free**
4. Click **Create Database**
5. Copy the **Internal Database URL** (starts with `postgresql://`)

### Step 12: Create a Redis instance
1. Render Dashboard → **New** → **Redis**
2. Name: `rideshare-redis`
3. Plan: **Free**
4. Click **Create**
5. Copy the **Internal Redis URL** (starts with `redis://`)

### Step 13: Deploy the backend as a Web Service
1. Render Dashboard → **New** → **Web Service**
2. Connect your GitHub repo
3. Settings:
   - **Name**: `rideshare-backend`
   - **Root Directory**: `backend`
   - **Runtime**: Node
   - **Build Command**: `npm ci && npx prisma generate`
   - **Start Command**: `npx prisma db push && npm start`
   - **Plan**: Free

4. Add Environment Variables (click **Environment**):

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | *(paste from Step 11)* |
| `REDIS_URL` | *(paste from Step 12)* |
| `JWT_SECRET` | *(run: `openssl rand -hex 32`)* |
| `FRONTEND_URL` | *(leave blank for now, fill after Step 17)* |
| `PORT` | `3001` |

5. Click **Create Web Service**

Wait ~3 minutes for the first deploy. Your backend URL will be:
`https://rideshare-backend.onrender.com`

Test it: `https://rideshare-backend.onrender.com/health`

### Step 14: Seed the production database
In Render Dashboard → your backend service → **Shell** tab:
```bash
node src/utils/seed.js
```

---

## PART 4 — Deploy Frontend to Vercel

### Step 15: Create a Vercel account
Sign up at https://vercel.com using your GitHub account.

### Step 16: Import your repository
1. Vercel Dashboard → **Add New Project**
2. Select your `distributed-ride-matching` repo
3. Settings:
   - **Framework Preset**: Vite
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`

4. Add Environment Variables:

| Key | Value |
|-----|-------|
| `VITE_API_URL` | `https://rideshare-backend.onrender.com` |
| `VITE_WS_URL` | `wss://rideshare-backend.onrender.com` |

5. Click **Deploy**

After ~1 minute, your frontend is live at:
`https://distributed-ride-matching.vercel.app`

### Step 17: Update backend CORS
Go back to Render → rideshare-backend → Environment:
- Set `FRONTEND_URL` = `https://distributed-ride-matching.vercel.app`

Then trigger a **Manual Deploy** on Render.

---

## PART 5 — Set Up Auto-Deploy (CI/CD)

Now every `git push` to `main` will:
1. Run CI tests on GitHub Actions
2. Auto-deploy backend on Render (enabled by default)
3. Auto-deploy frontend on Vercel (enabled by default)

### Step 18: Add Docker Hub secrets (optional — for Docker image builds)
If you want the Docker build step in CI to run:
1. Create account at https://hub.docker.com
2. GitHub repo → **Settings** → **Secrets and variables** → **Actions**
3. Add:
   - `DOCKERHUB_USERNAME` = your Docker Hub username
   - `DOCKERHUB_TOKEN` = Docker Hub access token (Account Settings → Security)

### Step 19: Test the full flow
```bash
# Make a change
echo "# Updated" >> README.md
git add .
git commit -m "test: trigger CI/CD pipeline"
git push
```

Watch GitHub Actions → Render → Vercel all update automatically.

---

## PART 6 — Test the Live App

### Step 20: Open two browser tabs
**Tab 1 — Rider**: Login as `alice@example.com / password123`
**Tab 2 — Driver**: Login as `driver1@example.com / password123`

1. In Tab 2 (Driver): Click **Go Online**
2. In Tab 1 (Rider): Select pickup + dropoff → click **Request Ride**
3. Watch the WebSocket push match them in real time!

**Admin dashboard**: Login as `admin@rideshare.com / admin123` to see system metrics.

---

## Troubleshooting

### Backend won't start on Render
Check logs for Prisma errors. Run in Shell: `npx prisma db push`

### WebSocket not connecting on production
Make sure `VITE_WS_URL` uses `wss://` (not `ws://`) for HTTPS deployments.

### Kafka not available warning
This is expected on free hosting — the app runs in Redis-only mode automatically. All core features still work.

### CORS errors
Ensure `FRONTEND_URL` on backend matches your Vercel URL exactly (no trailing slash).

---

## Architecture Summary

```
GitHub (code + CI)
    │
    ├── GitHub Actions (runs tests on every push)
    │
    ├── Render (backend)
    │   ├── Node.js + Express + Socket.io
    │   ├── Render PostgreSQL (trips, users, billing)
    │   └── Render Redis (geo-index, locking, sessions)
    │
    └── Vercel (frontend)
        └── React + Vite (static, served from CDN)
```
